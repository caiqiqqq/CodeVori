import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpAgent, AcpAgentInfo, AcpAgentManagement, AcpAgentUpdate } from "@zcode/shared";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [operationAgent, setOperationAgent] = useState<AcpAgent | null>(null);
  const generation = useRef(0);
  const subscriptions = useRef(new Set<() => void>());

  useEffect(() => {
    const currentGeneration = ++generation.current;
    // 修复原因：切到另一台 Host 或远端断线时，旧 Host 的安装状态不能留在新目标列表。
    setAgents([]);
    setError(null);
    setBusy(false);
    setLog([]);
    setOperationAgent(null);
    if (!service) {
      setLoading(false);
      return () => {
        generation.current++;
      };
    }
    setLoading(true);
    void service
      .listAgents()
      .then((result) => {
        if (generation.current !== currentGeneration) return;
        setAgents(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current === currentGeneration) setError(errorMessage(cause));
      })
      .finally(() => {
        if (generation.current === currentGeneration) setLoading(false);
      });
    return () => {
      generation.current++;
      for (const dispose of subscriptions.current) dispose();
      subscriptions.current.clear();
    };
  }, [service]);

  const update = useCallback(
    async (input: AcpAgentUpdate) => {
      if (!service) return;
      const currentGeneration = generation.current;
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
    async (agent: AcpAgent, action: AcpAgentManagement["action"]) => {
      if (!service) return;
      const currentGeneration = generation.current;
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
        await service.manageAgent({ agent, action, operationId });
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

  return { agents, loading, error, busy, log, operationAgent, update, manage };
}
