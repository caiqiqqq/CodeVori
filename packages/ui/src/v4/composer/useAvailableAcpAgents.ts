import { useEffect, useReducer, useState } from "react";
import type { IAcpService } from "@zcode/services";
import { acpAgentAvailabilityListSchema, type AcpAgentAvailability } from "@zcode/shared";
import { logger } from "@/logger.js";

interface AgentRead {
  service: IAcpService;
  revision: number;
  agents: AcpAgentAvailability[];
}

/** Each menu opening refreshes the target Host's adapter state; old Host results never enter a new menu. */
export function useAvailableAcpAgents(service: IAcpService | null, enabled: boolean) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [read, setRead] = useState<AgentRead | null>(null);

  useEffect(() => {
    if (!enabled || !service) return;
    let active = true;
    void service
      .listAvailableAgents()
      .then((agents) => {
        if (active)
          setRead({ service, revision, agents: acpAgentAvailabilityListSchema.parse(agents) });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        // Bug 原因：读取失败后沿用上次菜单的安装快照，会把已卸载或旧 Host 的 Agent 误报为可用。
        setRead({ service, revision, agents: [] });
        logger.warn("[acp-model-menu] 读取目标 Host 的智能体状态失败", cause);
      });
    return () => {
      active = false;
    };
  }, [enabled, revision, service]);

  return {
    agents: enabled && read?.service === service && read.revision === revision ? read.agents : [],
    refresh,
  };
}
