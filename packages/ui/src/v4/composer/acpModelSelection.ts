import {
  ACP_AGENT_CATALOG,
  acpAgentSchema,
  type AcpAgent,
  type AcpAgentInfo,
  type AcpSession,
} from "@zcode/shared";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";

export function acpModelValue(agent: AcpAgent): string {
  return `acp:${agent}`;
}

export function acpAgentFromModelValue(value: string): AcpAgent | null {
  if (!value.startsWith("acp:")) return null;
  return acpAgentSchema.safeParse(value.slice(4)).data ?? null;
}

export function buildAcpModelSelectGroup(
  label: string,
  agents: readonly Pick<AcpAgentInfo, "agent" | "enabled" | "ready">[],
): ModelSelectGroup {
  const available = new Set(
    agents.filter((agent) => agent.enabled && agent.ready).map((agent) => agent.agent),
  );
  return {
    key: "family:acp-agents",
    label,
    directItems: true,
    items: ACP_AGENT_CATALOG.filter(({ id }) => available.has(id)).map(({ id, name }) => ({
      key: acpModelValue(id),
      value: acpModelValue(id),
      name,
    })),
  };
}

export function selectAcpSession(
  sessions: readonly AcpSession[],
  agent: AcpAgent,
  selectedId: string | null,
): AcpSession | null {
  // 修复原因：模型切换没有历史选择意图；空 id 或失效 id 不能回退到第一条旧会话。
  if (!selectedId) return null;
  return sessions.find((session) => session.id === selectedId && session.agent === agent) ?? null;
}
