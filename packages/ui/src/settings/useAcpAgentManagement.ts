import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
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
      else setLoading(true);
      setError(null);
      try {
        const result = await service.listAgents(options);
        if (!isCurrent()) return false;
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

  useEffect(() => {
    ++generation.current;
    active.current = true;
    // 修复原因：切到另一台 Host 或远端断线时，旧 Host 的安装状态不能留在新目标列表。
    setAgents([]);
    setError(null);
    setBusy(false);
    setLog([]);
    setOperationAgent(null);
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
      if (!service || !active.current || currentService.current !== service) return;
      const currentGeneration = generation.current;
      // 旧检查不能在保存完成后把旧安装/环境状态写回来。
      requestSequence.current++;
      setChecking(false);
      setBusy(true);
      setError(null);
      try {
        const next = await service.updateAgent(input);
        if (generation.current === currentGeneration) {
          setAgents((previous) =>
            previous.map((item) => (item.agent === next.agent ? next : item)),
          );
        }
      } catch (cause) {
        if (generation.current === currentGeneration) setError(errorMessage(cause));
        throw cause;
      } finally {
        if (generation.current === currentGeneration) setBusy(false);
      }
    },
    [service],
  );

  const manage = useCallback(
    async (agent: AcpAgent, action: AcpAgentManagement["action"], expectedVersion?: string) => {
      if (!service || !active.current || currentService.current !== service) return;
      const currentGeneration = generation.current;
      requestSequence.current++;
      setChecking(false);
      setBusy(true);
      setError(null);
      setLog([]);
      setOperationAgent(agent);
      const operationId = crypto.randomUUID();
      let disposeSubscription: (() => void) | undefined;
      try {
        const subscription = service.onDynamicAgentOperation(operationId)((event) => {
          if (generation.current === currentGeneration)
            setLog((previous) => [...previous, event.message]);
        });
        disposeSubscription = () => subscription.dispose();
        subscriptions.current.add(disposeSubscription);
        await service.manageAgent({
          agent,
          action,
          operationId,
          ...(expectedVersion && action !== "uninstall" ? { expectedVersion } : {}),
        });
        const next = await service.listAgents();
        if (generation.current === currentGeneration) setAgents(next);
      } catch (cause) {
        if (generation.current === currentGeneration) setError(errorMessage(cause));
        // 修复原因：包命令失败时可能已改动安装目录，必须重读目标 Host 的实际状态。
        if (generation.current === currentGeneration) {
          await service
            .listAgents()
            .then((next) => {
              if (generation.current === currentGeneration) setAgents(next);
            })
            .catch(() => {
              if (generation.current === currentGeneration) setAgents([]);
            });
        }
      } finally {
        disposeSubscription?.();
        if (disposeSubscription) subscriptions.current.delete(disposeSubscription);
        if (generation.current === currentGeneration) setBusy(false);
      }
    },
    [service],
  );

  return { agents, loading, checking, error, busy, log, operationAgent, refresh, update, manage };
}
