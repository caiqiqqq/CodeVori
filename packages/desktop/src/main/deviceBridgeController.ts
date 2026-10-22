import { isAbsolute } from "node:path";
import type {
  DeviceBridgeCommand,
  DeviceBridgeConfiguration,
  DeviceBridgeState,
  DeviceBridgeWorkerState,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";
import type { DeviceBridgeSession } from "./deviceBridgeProcess.js";

type Endpoint = { nodeId: string; url: string; token: string };
export function createDeviceBridgeController(ports: {
  readConfiguration(): Promise<DeviceBridgeConfiguration>;
  writeConfiguration(value: DeviceBridgeConfiguration): Promise<void>;
  startSession(onExit: () => void, configuration: DeviceBridgeConfiguration): DeviceBridgeSession;
  saveMcp(request: SaveCliMcpToUserDirectoryRequest): Promise<void>;
  checkMcp(endpoint: Endpoint): Promise<number>;
  openLogin(url: string): Promise<void>;
}) {
  let session: DeviceBridgeSession | undefined;
  let worker: DeviceBridgeWorkerState | undefined;
  let phase: DeviceBridgeState["phase"] = "stopped";
  let generation = 0,
    restored = false;
  let operations: Promise<unknown> = Promise.resolve();
  const endpoints = new Map<string, Endpoint>();
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
    if (response.state) worker = response.state;
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
      peers: worker?.peers.map((peer) => ({ ...peer, ...checks.get(peer.nodeId) })) ?? [],
      ...(phase === "error" ? { error: "device_bridge_process_closed" } : {}),
    };
  };
  const refresh = async () => {
    if (session) {
      await request("status");
      if (!restored && worker?.backendState === "Running") {
        const config = await ports.readConfiguration();
        const visible = new Set(worker.peers.map((p) => p.nodeId));
        const allowedNodes = config.allowedNodes.filter((id) => visible.has(id));
        if (allowedNodes.length) await request("expose", { allowedNodes });
        restored = true;
      }
    }
    return snapshot();
  };
  const stopProcess = async () => {
    const previous = session;
    generation++;
    session = undefined;
    worker = undefined;
    phase = "stopped";
    restored = false;
    await previous?.stop();
  };
  const perform = async (command: DeviceBridgeCommand): Promise<DeviceBridgeState> => {
    switch (command.action) {
      case "refresh":
        return refresh();
      case "configure": {
        if (session || !isAbsolute(command.binaryPath))
          throw new Error("device_bridge_invalid_configuration");
        const config = await ports.readConfiguration();
        await ports.writeConfiguration({ ...config, binaryPath: command.binaryPath });
        break;
      }
      case "start": {
        if (session) return refresh();
        const config = await ports.readConfiguration();
        if (!config.binaryPath || !isAbsolute(config.binaryPath))
          throw new Error("device_bridge_component_missing");
        await clearMcp();
        const epoch = ++generation;
        phase = "starting";
        session = ports.startSession(() => {
          if (generation !== epoch) return;
          // 旧进程结果不能复活新连接；退出后的投影立即清空。
          generation++;
          session = undefined;
          worker = undefined;
          phase = "error";
          restored = false;
          checks.clear();
          endpoints.clear();
          void enqueue(clearMcp).catch(() => {});
        }, config);
        try {
          await request("status");
          phase = "running";
          return refresh();
        } catch (error) {
          if (generation === epoch) {
            await stopProcess();
            phase = "error";
          }
          throw error;
        }
      }
      case "stop":
        await clearMcp();
        break;
      case "logout": {
        // 账号服务失败不能留下仍可控制本机的监听；保留错误供界面报告。
        try {
          if (session) await request("logout");
        } finally {
          await stopProcess();
          await clearMcp();
        }
        const config = await ports.readConfiguration();
        await ports.writeConfiguration({ ...config, allowedNodes: [] });
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
        const activeNodes = (nodes: string[]) => nodes.filter((id) => visible.has(id));
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
    read: () => enqueue(refresh),
    execute(command: DeviceBridgeCommand) {
      if (command.action === "stop") {
        const stopped = stopProcess();
        return enqueue(async () => {
          await stopped;
          return perform(command);
        });
      }
      return enqueue(() => perform(command));
    },
    async dispose() {
      await stopProcess();
      await enqueue(clearMcp);
    },
  };
}
