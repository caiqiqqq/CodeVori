import type { Event } from "@zcode/rpc";
import {
  ServiceChannels,
  type AcpAgentAvailability,
  type AcpPlugin,
  type AcpAgentInfo,
  type AcpAgentListOptions,
  type AcpAgentConfigSnapshot,
  type AcpAgentManagement,
  type AcpAgentOperationEvent,
  type AcpAgentUpdate,
  type AcpCodexConfig,
  type AcpCodexConfigUpdate,
  type AcpCodexModel,
  type AcpGeminiProviders,
  type AcpGeminiProvidersUpdate,
  type AcpCreateInput,
  type AcpSetConfigOptionInput,
  type AcpPromptSubmission,
  type AcpQueueItemInput,
  type AcpQueueEditInput,
  type AcpQueueReorderInput,
  type AcpQueueAutoDrainInput,
  type AcpStopInput,
  type AcpSession,
  type AcpDiagnosticEvent,
  type AcpExecutionTraceChanged,
  type AcpSessionRowUpdate,
  type AcpSessionSearchInput,
  type AcpSessionSearchItem,
  type AcpSessionChanged,
  type AcpWorkspace,
  type AcpAttachmentReadInput,
  type AcpAttachmentReadResult,
  type AcpAppUsageAgent,
  type AppUsageRequest,
  type AcpWorkflowControl,
  type AcpWorkflowArtifactQuery,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IAcpService {
  /** Current target Host's usable plugin references; no secrets or plugin runtime state escape. */
  listPlugins(workspace: AcpWorkspace & { id?: string }): Promise<AcpPlugin[]>;
  /** Local diagnostics by default; settings may explicitly check or refresh remote releases. */
  listAgents(options?: AcpAgentListOptions): Promise<AcpAgentInfo[]>;
  /** Runs the Host launch-readiness checks without executing adapter version commands. */
  listAvailableAgents(): Promise<AcpAgentAvailability[]>;
  /** Read-only known capabilities from this Host; never creates or reconnects an Agent. */
  listAgentConfigs(workspace: AcpWorkspace): Promise<AcpAgentConfigSnapshot[]>;
  /** Metadata-only invalidation; ordinary message and tool updates do not invalidate catalogs. */
  onDynamicAgentConfigsChanged(): Event<void>;
  updateAgent(input: AcpAgentUpdate): Promise<AcpAgentInfo>;
  readCodexConfig(): Promise<AcpCodexConfig>;
  updateCodexConfig(input: AcpCodexConfigUpdate): Promise<AcpCodexConfig>;
  listCodexModels(): Promise<AcpCodexModel[]>;
  listGeminiProviders(): Promise<AcpGeminiProviders>;
  updateGeminiProviders(input: AcpGeminiProvidersUpdate): Promise<AcpGeminiProviders>;
  manageAgent(input: AcpAgentManagement): Promise<AcpAgentInfo>;
  onDynamicAgentOperation(operationId: string): Event<AcpAgentOperationEvent>;
  list(workspace: AcpWorkspace): Promise<AcpSession[]>;
  /** Refuse active prompts/workflows, then disconnect idle adapters while preserving durable history. */
  prepareWorktreeRemoval(workspace: AcpWorkspace): Promise<boolean>;
  /** Current target Host's persisted usage; missing native reports remain unknown. */
  getUsageStats(request: AppUsageRequest): Promise<AcpAppUsageAgent[]>;
  /** Read-only history query; returns bounded display metadata without connecting an Agent. */
  search(input: AcpSessionSearchInput): Promise<AcpSessionSearchItem[]>;
  read(input: AcpWorkspace & { id: string }): Promise<AcpSession>;
  /** Bounded read of an accepted attachment; no Agent connection or arbitrary Host path. */
  readAttachment(input: AcpAttachmentReadInput): Promise<AcpAttachmentReadResult>;
  /** Exact target-Host snapshot path; never a native task or Agent log path. */
  getSessionFilePath(input: AcpWorkspace & { id: string }): Promise<string>;
  /** Exact target-Host per-session metadata log path; never an Agent-owned log. */
  getDiagnosticLogPath(input: AcpWorkspace & { id: string }): Promise<string>;
  /** Bounded, metadata-only ACP events from the same log. */
  getExecutionTrace(input: AcpWorkspace & { id: string }): Promise<AcpDiagnosticEvent[]>;
  /** Persisted metadata stream; reconnect by subscribing before reading the latest trace. */
  onDynamicExecutionTraceChanged(workspace: AcpWorkspace): Event<AcpExecutionTraceChanged>;
  /** Mutates only the target Host's durable ACP sidebar metadata. */
  updateRow(input: AcpSessionRowUpdate): Promise<AcpSession>;
  /** Reconnects an existing display snapshot so its Agent-owned options are current. */
  refresh(input: AcpWorkspace & { id: string }): Promise<AcpSession>;
  /** Optional preconnection returns an in-memory draft; composer can opt into permission memory. */
  create(input: AcpCreateInput): Promise<AcpSession>;
  /**
   * Persisted Host acceptance only; never waits for the Agent turn or live-event delivery.
   * @example await service.submitPrompt({ workspacePath, id, commandId, text });
   * The returned running/queued snapshot acknowledges input; task completion still uses prompt.
   */
  submitPrompt(input: AcpPromptSubmission): Promise<AcpSession>;
  /** Legacy/internal callers retain whole-turn completion for immediate execution. */
  prompt(input: AcpPromptSubmission): Promise<AcpSession>;
  /** Host queue operations share prompt admission and the same persisted session revision. */
  deleteQueueItem(input: AcpQueueItemInput): Promise<AcpSession>;
  editQueueItem(input: AcpQueueEditInput): Promise<AcpSession>;
  reorderQueueItem(input: AcpQueueReorderInput): Promise<AcpSession>;
  sendQueuedNow(input: AcpQueueItemInput): Promise<AcpSession>;
  setQueueAutoDrain(input: AcpQueueAutoDrainInput): Promise<AcpSession>;
  /** Admit a Host result only to an already connected, idle conversation; never reconnect. */
  notifyResult(
    input: AcpWorkspace & { id: string; commandId: string; text: string },
  ): Promise<boolean>;
  setGoal(input: AcpWorkspace & { id: string; goal: string | null }): Promise<AcpSession>;
  /** Remember only explicit composer permission choices on the target Host. */
  setConfigOption(input: AcpSetConfigOptionInput): Promise<AcpSession>;
  stop(input: AcpStopInput): Promise<void>;
  cancelWorkflow(input: AcpWorkflowControl): Promise<void>;
  resumeWorkflow(input: AcpWorkflowControl): Promise<void>;
  getWorkflowArtifact(input: AcpWorkflowArtifactQuery): Promise<{ path: string }>;
  decide(input: AcpWorkspace & { id: string; requestId: string; optionId: string }): Promise<void>;
  /** Automatic pane cleanup may discard a draft but must never delete an admitted turn. */
  remove(input: AcpWorkspace & { id: string; provisionalOnly?: boolean }): Promise<void>;
  /** Durable Host snapshots; coalesced stream updates may skip intermediate revisions. */
  onDynamicSessionChanged(workspace: AcpWorkspace): Event<AcpSessionChanged>;
}

export const IAcpService = createServiceDescriptor<IAcpService>(ServiceChannels.Acp);
