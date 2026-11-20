import {
  agentProfileSaveSchema,
  agentProfileDeleteSchema,
  delegationProfileCreateSchema,
  type AgentProfileSave,
  type AgentProfileDelete,
  type DelegationProfileCreate,
} from "@zcode/shared";
import type { DelegationDependencies } from "./contract.js";
import type { DelegationRepository } from "./delegationRepository.js";
import { validateSquadTargets } from "./agentSquads.js";
import { admitDelegation } from "./delegationAdmission.js";

export async function saveAgentProfile(
  repo: DelegationRepository,
  deps: DelegationDependencies,
  raw: AgentProfileSave,
) {
  const input = agentProfileSaveSchema.parse(raw);
  await repo.open();
  await validateSquadTargets(deps, { leader: input, members: [] });
  return repo.transaction(() => {
    const current = repo.profiles().find((profile) => profile.id === input.id);
    if ((current?.revision ?? 0) !== input.expectedRevision)
      throw new Error("delegation.profile-conflict");
    const { expectedRevision, ...fields } = input;
    const profile = {
      ...fields,
      revision: expectedRevision + 1,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    repo.putProfile(profile);
    return profile;
  });
}
export async function deleteAgentProfile(repo: DelegationRepository, raw: AgentProfileDelete) {
  const input = agentProfileDeleteSchema.parse(raw);
  await repo.open();
  repo.transaction(() => {
    const profile = repo.profiles().find((profile) => profile.id === input.id);
    if (!profile || profile.revision !== input.expectedRevision)
      throw new Error("delegation.profile-conflict");
    if (
      repo
        .squads()
        .some((squad) =>
          [squad.leader, ...squad.members].some((member) => member.agentId === input.id),
        )
    )
      throw new Error("delegation.profile-in-use");
    repo.deleteProfile(input.id);
  });
}
export async function admitProfile(
  repo: DelegationRepository,
  deps: DelegationDependencies,
  raw: DelegationProfileCreate,
) {
  const input = delegationProfileCreateSchema.parse(raw);
  if (deps.allowExecution === false || input.workspaceIdentity || input.remoteSessionId)
    throw new Error("delegation.remote-unsupported");
  await repo.open();
  const existing = repo.list(input).find((task) => task.requestId === input.requestId);
  if (existing) return existing;
  const profile = repo.profiles().find((profile) => profile.id === input.profileId);
  if (!profile) throw new Error("delegation.profile-not-found");
  const { profileId: _id, ...fields } = input;
  return admitDelegation(
    repo,
    deps,
    { ...fields, execution: profile.execution },
    undefined,
    undefined,
    profile,
  );
}
