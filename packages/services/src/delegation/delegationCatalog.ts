import { Emitter } from "@zcode/rpc";
import type {
  AgentProfileSave,
  AgentProfileDelete,
  AgentSquadSave,
  AgentSquadDelete,
} from "@zcode/shared";
import type { DelegationDependencies } from "./contract.js";
import { DelegationRepository } from "./delegationRepository.js";
import { saveAgentProfile, deleteAgentProfile } from "./agentProfiles.js";
import { saveAgentSquad, deleteAgentSquad } from "./agentSquads.js";

/** 同一个 Host 服务的配置部分；与准入共用 repository，不建立另一份目录状态。 */
export class DelegationCatalog {
  protected readonly repo: DelegationRepository;
  protected readonly squadEmitter = new Emitter<void>();
  protected disposed = false;
  constructor(protected readonly deps: DelegationDependencies) {
    this.repo = new DelegationRepository(deps.path);
  }
  async listAgentProfiles() {
    await this.repo.open();
    return this.repo.profiles();
  }
  async listSquads() {
    await this.repo.open();
    return this.repo.squads();
  }
  onDynamicSquadsChanged() {
    return this.squadEmitter.event;
  }
  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("delegation.closed");
    const result = await action();
    this.squadEmitter.fire();
    return result;
  }
  saveAgentProfile(input: AgentProfileSave) {
    return this.mutate(() => saveAgentProfile(this.repo, this.deps, input));
  }
  deleteAgentProfile(input: AgentProfileDelete) {
    return this.mutate(() => deleteAgentProfile(this.repo, input));
  }
  saveSquad(input: AgentSquadSave) {
    return this.mutate(() => saveAgentSquad(this.repo, this.deps, input));
  }
  deleteSquad(input: AgentSquadDelete) {
    return this.mutate(() => deleteAgentSquad(this.repo, input));
  }
}
