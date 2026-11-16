import {
  agentSquadSaveSchema,
  agentSquadDeleteSchema,
  delegationSquadCreateSchema,
  type AgentSquad,
  type AgentSquadSave,
  type AgentSquadDelete,
  type DelegationSquadCreate,
} from "@zcode/shared";
import type { DelegationDependencies } from "./contract.js";
import { admitDelegation, findDelegationBinding } from "./delegationAdmission.js";
import type { DelegationRepository } from "./delegationRepository.js";
import { listDelegationTargets } from "./delegationTargets.js";

export async function validateSquadTargets(
  deps: DelegationDependencies,
  squad: Pick<AgentSquad, "leader" | "members">,
) {
  const targets = await listDelegationTargets(deps);
  for (const member of [squad.leader, ...squad.members]) {
    const execution = member.execution;
    const available = targets.some((target) =>
      execution.kind === "acp"
        ? target.kind === "acp" && target.agent === execution.agent
        : target.kind === "api" &&
          target.execution.modelSelection.providerId === execution.modelSelection.providerId &&
          target.execution.modelSelection.modelId === execution.modelSelection.modelId &&
          !!execution.modelSelection.options?.reasoningLevel &&
          target.reasoningLevels.includes(execution.modelSelection.options.reasoningLevel),
    );
    if (!available) throw new Error("delegation.squad-target-unavailable");
  }
}
export async function saveAgentSquad(
  repo: DelegationRepository,
  deps: DelegationDependencies,
  raw: AgentSquadSave,
) {
  const input = agentSquadSaveSchema.parse(raw);
  await repo.open();
  await validateSquadTargets(deps, input);
  return repo.transaction(() => {
    const current = repo.squads().find((squad) => squad.id === input.id);
    if ((current?.revision ?? 0) !== input.expectedRevision)
      throw new Error("delegation.squad-conflict");
    const { expectedRevision, ...fields } = input;
    const squad: AgentSquad = {
      ...fields,
      revision: expectedRevision + 1,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    repo.putSquad(squad);
    return squad;
  });
}
export async function deleteAgentSquad(repo: DelegationRepository, raw: AgentSquadDelete) {
  const input = agentSquadDeleteSchema.parse(raw);
  await repo.open();
  repo.transaction(() => {
    const current = repo.squads().find((squad) => squad.id === input.id);
    if (!current || current.revision !== input.expectedRevision)
      throw new Error("delegation.squad-conflict");
    repo.deleteSquad(input.id);
  });
}
export async function admitSquad(
  repo: DelegationRepository,
  deps: DelegationDependencies,
  raw: DelegationSquadCreate,
) {
  const input = delegationSquadCreateSchema.parse(raw);
  if (deps.allowExecution === false || input.workspaceIdentity || input.remoteSessionId)
    throw new Error("delegation.remote-unsupported");
  await repo.open();
  const existing = repo.list(input).find((task) => task.requestId === input.requestId);
  if (existing) return existing;
  if (findDelegationBinding(repo, input)) throw new Error("delegation.nesting-disabled");
  const squad = repo.squads().find((item) => item.id === input.squadId);
  if (!squad) throw new Error("delegation.squad-not-found");
  await validateSquadTargets(deps, squad);
  const { squadId: _id, ...fields } = input;
  return admitDelegation(
    repo,
    deps,
    { ...fields, execution: squad.leader.execution, intent: "analysis" },
    undefined,
    { role: "leader", definition: squad, memberIntent: input.intent },
  );
}
