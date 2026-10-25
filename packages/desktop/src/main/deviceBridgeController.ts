import { createDeviceBridgeInspector } from "./deviceBridgeInspection.js";
import { createDeviceBridgeCredentials } from "./deviceBridgeCredentials.js";
import type {
  DeviceBridgeControllerPorts,
  DeviceBridgeEndpoint,
} from "./deviceBridgeControllerPorts.js";
import { isAbsolute } from "node:path";
import {
  getDeviceBridgeErrorCode,
  type DeviceBridgeCommand,
  type DeviceBridgeState,
  type DeviceBridgeWorkerState,
  type DeviceBridgeErrorCode,
} from "@zcode/shared";
import type { DeviceBridgeSession } from "./deviceBridgeProcess.js";

export function createDeviceBridgeController(ports: DeviceBridgeControllerPorts) {
  let session: DeviceBridgeSession | undefined;
  let worker: DeviceBridgeWorkerState | undefined;
  let phase: DeviceBridgeState["phase"] = "stopped";
  let failure: DeviceBridgeErrorCode | undefined;
  let generation = 0,
    restored = false;
  let operations: Promise<unknown> = Promise.resolve();
  let restoration: Promise<void> | undefined;
  const credentials = createDeviceBridgeCredentials(ports.credentials);
  let removal: AbortController | undefined;
  // 控制面删除已确认后，滞后的 tsnet 快照不能重新发布设备或恢复授权。
  const removed = new Set<string>();
  const endpoints = new Map<string, DeviceBridgeEndpoint>();
  const installed = new Set<string>();
  const checks = new Map<string, { toolCount: number; checkedAt: string }>();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  };
  const name = (id: string) => `device-bridge-${Buffer.from(id).toString("hex")}`;
  const deleteMcp = async (id: string) => {
    if (installed.has(id)) {
      await ports.saveMcp({ action: "delete", source: "zcodeagentmcp", name: name(id) });
      installed.delete(id);
    }
    endpoints.delete(id);
    checks.delete(id);
  };
  const clearMcp = async () => {
    for (const id of installed) await deleteMcp(id);
    endpoints.clear();
    checks.clear();
  };
  const assertCurrent = (epoch: number) => {
    if (generation !== epoch || !session) throw new Error("device_bridge_process_closed");
  };
  const request = async (method: string, fields?: Record<string, unknown>) => {
    const current = session,
      epoch = generation;
    if (!current) throw new Error("device_bridge_not_running");
    const response = await current.request(method, fields);
    assertCurrent(epoch);
    if (response.state) {
      worker = response.state;
      await credentials.activate(worker);
      assertCurrent(epoch);
    }
    return response;
  };
  const snapshot = async (): Promise<DeviceBridgeState> => {
    const config = await ports.readConfiguration();
    return {
      binaryPath: config.binaryPath,
      phase,
      backendState: worker?.backendState ?? "Stopped",
      canLogin: Boolean(worker?.authUrl),
      nodeId: worker?.nodeId ?? "",
      dnsName: worker?.dnsName ?? "",
      loginName: worker?.loginName ?? "",
      tailnet: worker?.tailnet ?? "",
      exposing: worker?.exposing ?? false,
      ...credentials.status(),
      peers:
        worker?.peers
          .filter((peer) => !removed.has(peer.nodeId))
          .map((peer) => ({ ...peer, ...checks.get(peer.nodeId) })) ?? [],
      ...(phase === "error" ? { error: failure ?? "device_bridge_process_closed" } : {}),
    };
  };
  const refresh = async () => {
    if (session) {
      await request("status");
      if (!restored && worker?.backendState === "Running") {
        const config = await ports.readConfiguration();
        const visible = new Set(worker.peers.map((p) => p.nodeId));
        const allowedNodes = config.allowedNodes.filter(
          (id) => visible.has(id) && !removed.has(id),
        );
        if (allowedNodes.length) await request("expose", { allowedNodes });
        restored = true;
      }
    }
    return snapshot();
  };
  const stopProcess = async () => {
    credentials.cancelPending();
    removal?.abort();
    const previous = session;
    generation++;
    session = undefined;
    worker = undefined;
    phase = "stopped";
    failure = undefined;
    restored = false;
    await previous?.stop();
  };
  const removeGrants = async () => {
    const config = await ports.readConfiguration();
    const allowedNodes = config.allowedNodes.filter((id) => !removed.has(id));
    if (allowedNodes.length !== config.allowedNodes.length)
      await ports.writeConfiguration({ ...config, allowedNodes });
    return allowedNodes;
  };
  const removeDevice = async (nodeId: string) => {
    if (!credentials.key()) throw new Error("device_bridge_management_required");
    const epoch = generation;
    const revision = credentials.revision();
    await request("status");
    assertCurrent(epoch);
    if (!credentials.key() || revision !== credentials.revision())
      throw new Error("device_bridge_management_required");
    if (
      worker?.backendState !== "Running" ||
      nodeId === worker.nodeId ||
      removed.has(nodeId) ||
      !worker.peers.some((peer) => peer.nodeId === nodeId)
    )
      throw new Error("device_bridge_invalid_device");
    const pending = new AbortController();
    removal = pending;
    try {
      await ports.removeDevice(credentials.key(), nodeId, pending.signal);
    } finally {
      if (removal === pending) removal = undefined;
    }
    removed.add(nodeId);
    try {
      const allowedNodes = await removeGrants();
      if (generation === epoch && session) {
        const visible = new Set(worker?.peers.map((peer) => peer.nodeId));
        await request("expose", { allowedNodes: allowedNodes.filter((id) => visible.has(id)) });
        await request("disconnect", { nodeId });
      }
      await deleteMcp(nodeId);
    } catch {
      // 远端删除不可回滚；本地清理失败时关闭全部监听，并在下次启动前重试。
      await stopProcess().catch(() => {});
      await clearMcp().catch(() => {});
      phase = "error";
      failure = "device_bridge_removal_cleanup_failed";
      throw new Error(failure);
    }
  };
  const perform = async (command: DeviceBridgeCommand): Promise<DeviceBridgeState> => {
    if ("nodeId" in command && removed.has(command.nodeId))
      throw new Error("device_bridge_invalid_device");
    switch (command.action) {
      case "configure-management":
        if (!session) throw new Error("device_bridge_management_account_required");
        await request("status");
        await credentials.save(command.apiKey);
        break;
      case "clear-management":
        await credentials.clear();
        break;
      case "remove":
        await removeDevice(command.nodeId);
        break;
      case "refresh":
        return refresh();
      case "configure": {
        if (session || !isAbsolute(command.binaryPath))
          throw new Error("device_bridge_invalid_configuration");
        const config = await ports.readConfiguration();
        await ports.writeConfiguration({ ...config, binaryPath: command.binaryPath });
        phase = "stopped";
        failure = undefined;
        break;
      }
      case "start": {
        if (session) return refresh();
        const epoch = ++generation;
        phase = "starting";
        failure = undefined;
        try {
          await removeGrants();
          const config = await ports.readConfiguration();
          await ports.writeConfiguration({ ...config, networkingEnabled: true });
          await clearMcp();
          if (generation !== epoch) throw new Error("device_bridge_process_closed");
          if (!config.binaryPath || !isAbsolute(config.binaryPath))
            throw new Error("device_bridge_component_missing");
          const started = await ports.startSession((reason) => {
            if (generation !== epoch) return;
            // 旧进程结果不能复活新连接；退出后的投影立即清空。
            generation++;
            removal?.abort();
            session = undefined;
            worker = undefined;
            phase = "error";
            failure = reason ?? "device_bridge_process_closed";
            restored = false;
            checks.clear();
            endpoints.clear();
            void enqueue(clearMcp).catch(() => {});
          }, config);
          // 预检是异步 IO；停止命令可抢先失效代次，迟到的进程必须关闭，不能恢复 running。
          if (generation !== epoch) {
            await started.stop();
            throw new Error("device_bridge_process_closed");
          }
          session = started;
          await request("status");
          phase = "running";
          return refresh();
        } catch (error) {
          if (generation === epoch) {
            await stopProcess();
            phase = "error";
            failure = getDeviceBridgeErrorCode(error);
          }
          throw error;
        }
      }
      case "stop": {
        try {
          const config = await ports.readConfiguration();
          await ports.writeConfiguration({ ...config, networkingEnabled: false });
        } finally {
          await clearMcp();
        }
        break;
      }
      case "logout": {
        // 账号服务失败不能留下仍可控制本机的监听；保留错误供界面报告。
        try {
          try {
            await credentials.clear();
          } finally {
            const config = await ports.readConfiguration();
            await ports.writeConfiguration({
              ...config,
              allowedNodes: [],
              networkingEnabled: false,
            });
            if (session) await request("logout");
          }
        } finally {
          await stopProcess();
          await clearMcp();
        }
        break;
      }
      case "open-login": {
        await refresh();
        const url = new URL(worker?.authUrl ?? "about:blank");
        if (
          url.origin !== "https://login.tailscale.com" ||
          !/^\/(a|admin)\//.test(url.pathname) ||
          url.username ||
          url.password
        )
          throw new Error("device_bridge_invalid_login_url");
        await ports.openLogin(url.toString());
        break;
      }
      case "connect": {
        const epoch = generation;
        const response = await request("connect", { nodeId: command.nodeId });
        const endpoint = response.connection;
        if (!endpoint || endpoint.nodeId !== command.nodeId)
          throw new Error("device_bridge_invalid_endpoint");
        try {
          const toolCount = await ports.checkMcp(endpoint);
          assertCurrent(epoch);
          installed.add(command.nodeId);
          await ports.saveMcp({
            action: "upsert",
            source: "zcodeagentmcp",
            name: name(command.nodeId),
            config: {
              type: "http",
              url: endpoint.url,
              headers: { Authorization: `Bearer ${endpoint.token}` },
            },
          });
          assertCurrent(epoch);
          endpoints.set(command.nodeId, endpoint);
          checks.set(command.nodeId, { toolCount, checkedAt: new Date().toISOString() });
        } catch (error) {
          await deleteMcp(command.nodeId);
          if (session && generation === epoch)
            await request("disconnect", { nodeId: command.nodeId });
          throw error;
        }
        break;
      }
      case "disconnect":
        await request("disconnect", { nodeId: command.nodeId });
        await deleteMcp(command.nodeId);
        break;
      case "check": {
        const endpoint = endpoints.get(command.nodeId),
          epoch = generation;
        if (!endpoint) throw new Error("device_bridge_not_connected");
        checks.delete(command.nodeId);
        const toolCount = await ports.checkMcp(endpoint);
        assertCurrent(epoch);
        checks.set(command.nodeId, { toolCount, checkedAt: new Date().toISOString() });
        break;
      }
      case "authorize": {
        const config = await ports.readConfiguration();
        const ids = new Set(config.allowedNodes);
        if (command.allowed) ids.add(command.nodeId);
        else ids.delete(command.nodeId);
        const allowedNodes = [...ids];
        // 已移除或暂不可见的旧设备不应阻塞当前设备的撤销授权。
        const visible = new Set(worker?.peers.map((peer) => peer.nodeId));
        const activeNodes = (nodes: string[]) =>
          nodes.filter((id) => visible.has(id) && !removed.has(id));
        await request("expose", { allowedNodes: activeNodes(allowedNodes) });
        try {
          await ports.writeConfiguration({ ...config, allowedNodes });
        } catch (error) {
          await request("expose", { allowedNodes: activeNodes(config.allowedNodes) });
          throw error;
        }
        break;
      }
    }
    return snapshot();
  };
  return {
    restore(): Promise<void> {
      const epoch = generation;
      return (restoration ??= enqueue(async () => {
        try {
          const config = await ports.readConfiguration();
          // 停止可抢先失效代次；迟到的磁盘读取不能覆盖用户刚做出的停止选择。
          if (generation === epoch && config.networkingEnabled && !session)
            await perform({ action: "start" });
        } catch (error) {
          if (generation === epoch) {
            phase = "error";
            failure = getDeviceBridgeErrorCode(error);
          }
          throw error;
        }
      }));
    },
    inspect: createDeviceBridgeInspector({
      read: ports.inspectMcp,
      connection(nodeId) {
        const endpoint = endpoints.get(nodeId);
        return session &&
          worker?.backendState === "Running" &&
          endpoint &&
          checks.has(nodeId) &&
          !removed.has(nodeId)
          ? { endpoint, generation }
          : undefined;
      },
    }),
    read: () => enqueue(refresh),
    execute(command: DeviceBridgeCommand) {
      const revision = credentials.revision();
      const epoch = generation;
      if (command.action === "logout" || command.action === "clear-management") {
        credentials.invalidate();
        removal?.abort();
      }
      if (command.action === "stop") {
        const stopped = stopProcess();
        return enqueue(async () => {
          await stopped;
          return perform(command);
        });
      }
      return enqueue(() => {
        if (command.action === "remove" && epoch !== generation)
          throw new Error("device_bridge_process_closed");
        // 清密钥/退出须取消尚在队列或 status IO 中的删除，不能由更早排队的配置复活。
        if (command.action === "remove" && revision !== credentials.revision())
          throw new Error("device_bridge_management_required");
        return perform(command);
      });
    },
    async dispose() {
      credentials.invalidate();
      await stopProcess();
      await enqueue(async () => {
        credentials.invalidate();
        await clearMcp();
      });
    },
  };
}
