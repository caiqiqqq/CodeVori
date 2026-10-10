import type { Event } from "@zcode/rpc";
import {
  ServiceChannels,
  type AcpAgentAvailability,
  type DelegationAgent,
  type DelegationApiAgent,
  type WorkTaskScope,
  type DelegationParent,
  type DelegationCreate,
  type DelegationTarget,
  type DelegationFollowUp,
  type DelegationTask,
  type DelegationSettings,
  type DelegationResult,
  type DelegationRedeliver,
} from "@zcode/shared";
import type { WorkTaskExecutionContext } from "../session/contract.js";
import { createServiceDescriptor } from "../descriptors.js";

export interface IAgentDelegationService {
  targets(): Promise<DelegationAgent[]>;
  list(parent: DelegationParent): Promise<DelegationTask[]>;
  /** Read-only removal guard; queued/running descendants must be handled explicitly first. */
  hasPendingChildren(parent: DelegationParent): Promise<boolean>;
  delegate(input: DelegationCreate): Promise<DelegationTask>;
  followUp(input: DelegationFollowUp): Promise<DelegationTask>;
  retry(input: DelegationTarget): Promise<DelegationTask>;
  resume(input: DelegationTarget): Promise<DelegationTask>;
  cancel(input: DelegationTarget): Promise<void>;
  cancelAll(parent: DelegationParent): Promise<void>;
  redeliver(input: DelegationRedeliver): Promise<void>;
  /** Missing enabled/cache fields in legacy persistence gain compatible defaults. */
  getSettings(scope: WorkTaskScope): Promise<DelegationSettings>;
  /** Disabling gates new admissions only; cache budgets never delete durable results. */
  updateSettings(input: WorkTaskScope & DelegationSettings): Promise<void>;
  onDynamicChanged(parent: DelegationParent): Event<void>;
}
export const IAgentDelegationService = createServiceDescriptor<IAgentDelegationService>(
  ServiceChannels.AgentDelegation,
);
export interface DelegationDependencies {
  path: string;
  targets(): Promise<AcpAgentAvailability[]>;
  apiTargets?(): Promise<DelegationApiAgent[]>;
  execute(task: DelegationTask, context: WorkTaskExecutionContext): Promise<DelegationResult>;
  deliver(task: DelegationTask, commandId: string, text: string): Promise<boolean>;
  validateAssets?(input: DelegationCreate): Promise<void>;
  allowExecution?: boolean;
}
