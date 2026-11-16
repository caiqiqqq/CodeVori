import {
  acpAgentDefinition,
  getDelegationAgentReference,
  type AgentSquad,
  type AgentSquadMember,
  type AgentSquadSave,
  type DelegationAgent,
  type WorkTaskExecution,
} from "@zcode/shared";

export function squadTargetLabel(target: DelegationAgent) {
  return target.kind === "acp"
    ? acpAgentDefinition(target.agent).name
    : `${target.execution.modelSelection.modelId} (${target.providerName})`;
}
export function squadExecutionReference(execution: WorkTaskExecution) {
  return execution.kind === "acp"
    ? `acp.${execution.agent}`
    : getDelegationAgentReference({
        kind: "api",
        execution,
        providerName: "",
        reasoningLevels: [],
      });
}
export function squadRoleDraft(
  target: DelegationAgent,
  name: string,
  role: string,
): AgentSquadMember {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    execution:
      target.kind === "api"
        ? structuredClone(target.execution)
        : { kind: "acp", agent: target.agent, config: [] },
  };
}
export function squadDraft(squad: AgentSquad): AgentSquadSave {
  const { revision, createdAt: _created, updatedAt: _updated, ...fields } = squad;
  return { ...structuredClone(fields), expectedRevision: revision };
}
