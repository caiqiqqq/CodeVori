import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import { createUuid } from "@zcode/shared";
import { useAcpOperationSnapshot } from "@/settings/useAcpOperationSnapshot.js";
import {
  getAcpAgentUpgradePlan,
  type AcpAgentUpgradeBatch,
  type AcpAgentUpgradeResult,
  type AcpAgentUpgradeTarget,
} from "@/settings/acpAgentUpgrades.js";
import type {
  AcpAgent,
  AcpAgentInfo,
  AcpAgentListOptions,
  AcpAgentManagement,
  AcpAgentUpdate,
} from "@zcode/shared";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function formatAcpEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function parseAcpEnv(text: string): Record<string, string> {
  const env = new Map<string, string>();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    if (
      separator < 1 ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      env.has(key) ||
      ["PATH", "HOME", "NODE_OPTIONS", "NPM_CONFIG_PREFIX"].includes(key.toUpperCase())
    ) {
      // 修复原因：错误行可能是粘贴的凭据，校验提示只能显示行号，不能回显原文。
      throw new Error(`第 ${index + 1} 行环境变量名称无效或重复，请使用 KEY=value。`);
    }
    env.set(key, line.slice(separator + 1));
  }
  return Object.fromEntries(env);
}

/** Only the target Host owns installation state; the hook holds unsaved UI drafts. */
export function useAcpAgentManagement(service: IAcpService | null) {
  const [agents, setAgents] = useState<AcpAgentInfo[]>([]);
  const [loading, setLoading] = useState(Boolean(service));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [operationAgent, setOperationAgent] = useState<AcpAgent | null>(null);
  const [batch, setBatch] = useState<AcpAgentUpgradeBatch | null>(null);
  const commandPending = useRef(false);
  const stopRequested = useRef(false);
  const currentAgents = useRef(agents);
  currentAgents.current = agents;
  const generation = useRef(0);
  const requestSequence = useRef(0);
  const active = useRef(false);
  const currentService = useRef(service);
  currentService.current = service;
  const subscriptions = useRef(new Set<() => void>());

  const read = useCallback(
    async (options?: AcpAgentListOptions) => {
      if (!service || !active.current || currentService.current !== service) return false;
      const currentGeneration = generation.current;
      const sequence = ++requestSequence.current;
      const isCurrent = () =>
        generation.current === currentGeneration && requestSequence.current === sequence;
      if (options?.checkUpdates) setChecking(true);
      // 修复原因：操作结束后的重读不能卸载配置编辑器，否则批量升级会清空未保存草稿。
      else if (!currentAgents.current.length) setLoading(true);
      setError(null);
      try {
        const result = await service.listAgents(options);
        if (!isCurrent()) return false;
        currentAgents.current = result;
        setAgents(result);
        return true;
      } catch (cause) {
        if (isCurrent()) setError(errorMessage(cause));
        return false;
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setChecking(false);
        }
      }
    },
    [service],
  );

  const refresh = useCallback(() => read({ checkUpdates: true, force: true }), [read]);
  const operationsSupported = agents.some((agent) => agent.agentManagementSupported === true);
  const operationState = useAcpOperationSnapshot(service, operationsSupported, () => {
    void read();
  });
  const refreshOperation = operationState.refreshOperation;
  const blocked = useRef(false);
  blocked.current = operationState.busy || loading || checking;

  useEffect(() => {
    ++generation.current;
    active.current = true;
    // 修复原因：切到另一台 Host 或远端断线时，旧 Host 的安装状态不能留在新目标列表。
    setAgents([]);
    currentAgents.current = [];
    setError(null);
    setBusy(false);
    setLog([]);
    setOperationAgent(null);
    setBatch(null);
    commandPending.current = false;
    stopRequested.current = false;
    setChecking(false);
    if (!service) {
      setLoading(false);
      return () => {
        generation.current++;
        active.current = false;
      };
    }
    setLoading(true);
    // 修复原因：远端更新查询不能挡住本地设置；第二阶段检查不卸载面板或丢失草稿。
    void read().then((accepted) => {
      if (accepted) void read({ checkUpdates: true });
    });
    return () => {
      generation.current++;
      active.current = false;
      for (const dispose of subscriptions.current) dispose();
      subscriptions.current.clear();
    };
  }, [service, read]);

  const update = useCallback(
    async (input: AcpAgentUpdate) => {
      if (
        !service ||
        !active.current ||
        currentService.current !== service ||
        commandPending.current ||
        blocked.current
      )
        return;
      commandPending.current = true;
      const currentGeneration = generation.current;
      // 旧检查不能在保存完成后把旧安装/环境状态写回来。
      requestSequence.current++;
      setChecking(false);
      setBusy(true);
      setError(null);
      try {
        const next = await service.updateAgent(input);
        if (generation.current === currentGeneration) {
          const updated = currentAgents.current.map((item) =>
            item.agent === next.agent ? next : item,
          );
          currentAgents.current = updated;
          setAgents(updated);
        }
      } catch (cause) {
        if (generation.current === currentGeneration) setError(errorMessage(cause));
        throw cause;
      } finally {
        if (generation.current === currentGeneration) {
          commandPending.current = false;
          setBusy(false);
        }
      }
    },
    [service],
  );

  const runManagement = useCallback(
    async (agent: AcpAgent, action: AcpAgentManagement["action"], expectedVersion?: string) => {
      if (!service || !active.current || currentService.current !== service) return;
      const currentGeneration = generation.current;
      requestSequence.current++;
      setChecking(false);
      setError(null);
      let result: AcpAgentUpgradeResult = { agent, success: false };
      const operationId = createUuid();
      let disposeSubscription: (() => void) | undefined;
      try {
        // 新 Host 只订阅统一快照；按 ID 的临时日志仅用于旧 Host，避免维护第二份操作事实。
        if (!operationsSupported) {
          setLog([]);
          setOperationAgent(agent);
          const subscription = service.onDynamicAgentOperation(operationId)((event) => {
            if (generation.current === currentGeneration)
              setLog((previous) => [...previous.slice(-99), event.message.slice(0, 2048)]);
          });
          disposeSubscription = () => subscription.dispose();
          subscriptions.current.add(disposeSubscription);
        }
        await service.manageAgent({
          agent,
          action,
          operationId,
          ...(expectedVersion && action !== "uninstall" ? { expectedVersion } : {}),
        });
        result = { agent, success: true };
        const next = await service.listAgents();
        if (generation.current === currentGeneration) {
          currentAgents.current = next;
          setAgents(next);
        }
      } catch (cause) {
        result = { agent, success: false, error: errorMessage(cause) };
        if (generation.current === currentGeneration) setError(errorMessage(cause));
        // 修复原因：包命令失败时可能已改动安装目录，必须重读目标 Host 的实际状态。
        if (generation.current === currentGeneration) {
          await service
            .listAgents()
            .then((next) => {
              if (generation.current === currentGeneration) {
                currentAgents.current = next;
                setAgents(next);
              }
            })
            .catch(() => {
              if (generation.current === currentGeneration) {
                currentAgents.current = [];
                setAgents([]);
              }
            });
        }
      } finally {
        disposeSubscription?.();
        if (disposeSubscription) subscriptions.current.delete(disposeSubscription);
        if (generation.current === currentGeneration) await refreshOperation();
      }
      return result;
    },
    [service, operationsSupported, refreshOperation],
  );

  const manage = useCallback(
    async (agent: AcpAgent, action: AcpAgentManagement["action"], expectedVersion?: string) => {
      if (
        !service ||
        !active.current ||
        currentService.current !== service ||
        commandPending.current
      )
        return;
      const currentGeneration = generation.current;
      commandPending.current = true;
      setBusy(true);
      try {
        return await runManagement(agent, action, expectedVersion);
      } finally {
        if (generation.current === currentGeneration) {
          commandPending.current = false;
          setBusy(false);
        }
      }
    },
    [service, runManagement],
  );

  const upgradeAgents = useCallback(
    async (targets: AcpAgentUpgradeTarget[]) => {
      if (
        !service ||
        !active.current ||
        currentService.current !== service ||
        commandPending.current ||
        blocked.current
      )
        return;
      const plan = targets.filter(
        (item, index) => targets.findIndex((other) => other.agent === item.agent) === index,
      );
      if (!plan.length) return;
      const currentGeneration = generation.current;
      const isCurrent = () =>
        active.current &&
        generation.current === currentGeneration &&
        currentService.current === service;
      commandPending.current = true;
      stopRequested.current = false;
      setBusy(true);
      setBatch({ total: plan.length, current: plan[0]!.agent, results: [], stopped: false });
      try {
        for (const target of plan) {
          // 修复原因：切换 Host、停止或旧确认回执不能继续提交尚未执行的升级。
          if (!isCurrent() || stopRequested.current) break;
          setBatch((previous) => previous && { ...previous, current: target.agent });
          const eligible = getAcpAgentUpgradePlan(currentAgents.current).find(
            (item) => item.agent === target.agent,
          );
          const result =
            eligible?.expectedVersion === target.expectedVersion &&
            eligible.action === target.action
              ? await runManagement(target.agent, target.action, target.expectedVersion)
              : {
                  agent: target.agent,
                  success: false,
                  error: "ACP 发行目标或安装环境已变化，请重新检查更新。",
                };
          if (!isCurrent()) break;
          if (result)
            setBatch(
              (previous) => previous && { ...previous, results: [...previous.results, result] },
            );
        }
      } finally {
        if (isCurrent()) {
          commandPending.current = false;
          setBusy(false);
          setBatch((previous) => previous && { ...previous, current: null });
        }
      }
    },
    [service, runManagement],
  );

  const hostOperation = operationsSupported ? operationState.snapshot?.operation : null;
  return {
    agents,
    loading,
    checking,
    error: operationState.error ?? error,
    busy: busy || operationState.busy,
    log: operationsSupported ? (hostOperation?.log ?? []) : log,
    operationAgent: operationsSupported ? (hostOperation?.agent ?? null) : operationAgent,
    operation: hostOperation,
    cancel: operationState.cancel,
    refresh,
    update,
    manage,
    batch,
    upgradeAgents,
    stopBatch: () => {
      stopRequested.current = true;
      setBatch((previous) => previous && { ...previous, stopped: true });
    },
  };
}
