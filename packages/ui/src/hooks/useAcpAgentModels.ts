import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import { acpAgentModelSchema, type AcpAgentModel, type AcpAgent } from "@zcode/shared";

/** Only a target-Host catalog projection; the environment draft stays with the settings panel. */
export function useAcpAgentModels(service: IAcpService | null, agent: AcpAgent) {
  const [view, setView] = useState<{
    owner: IAcpService | null;
    agent: AcpAgent;
    models: AcpAgentModel[];
    loading: boolean;
    error: boolean;
  }>({ owner: service, agent, models: [], loading: Boolean(service), error: false });
  const generation = useRef(0);
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const reload = useCallback(async () => {
    if (!service) return;
    const request = ++generation.current;
    setView({ owner: service, agent, models: [], loading: true, error: false });
    try {
      // 旧 Host 不支持此方法时走统一错误提示，不暴露 RPC 或凭据错误原文。
      const models = acpAgentModelSchema.array().parse(await service.listAgentModels({ agent }));
      if (
        generation.current === request &&
        serviceRef.current === service &&
        agentRef.current === agent
      )
        setView({ owner: service, agent, models, loading: false, error: false });
    } catch {
      if (
        generation.current === request &&
        serviceRef.current === service &&
        agentRef.current === agent
      )
        setView({ owner: service, agent, models: [], loading: false, error: true });
    }
  }, [service, agent]);
  useEffect(() => {
    if (service) void reload();
    return () => {
      generation.current++;
    };
  }, [service, reload]);
  // 修复原因：换 Host 的第一帧也不能展示上一 Host 的模型，不能只等 effect 清理。
  const current =
    view.owner === service && view.agent === agent && service
      ? view
      : {
          models: [],
          loading: Boolean(service),
          error: false,
        };
  return { ...current, reload };
}
