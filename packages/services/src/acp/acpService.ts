import type { Event } from "@zcode/rpc";
import {
  ServiceChannels,
  type AcpAgentAvailability,
  type AcpPlugin,
  type AcpAgentInfo,
  type AcpAgentListOptions,
  type AcpAgentConfigSnapshot,
  type AcpAgentManagement,
  type AcpAgentManagementSnapshot,
  type AcpAgentOperationCancel,
  type AcpAgentOperationEvent,
  type AcpAgentUpdate,
  type AcpCodexConfig,
  type AcpCodexConfigUpdate,
  type AcpCodexModel,
  type AcpAgentModel,
  type AcpAgentModelsInput,
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
  type AcpTerminalControl,
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
  type AcpGenerateText,
  type AcpCancelGenerateText,
  type AcpGeneratedText,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  AcpConversationChange,
  AcpConversationRead,
  AcpConversationRowsRange,
  AcpConversationTarget,
  AcpSessionSummary,
  AcpSessionSummaryChanged,
  AcpConversationCommand,
  AcpCommandQuery,
  AcpCommandReceipt,
} from "@zcode/shared";
import type { V4ConversationRowsRangeResult } from "@zcode/shared/zcode-protocol-v4";

export interface IAcpService {
  /** Durable Host admission; no Agent turn wait and no conversation snapshot in the ACK. */
  sendConversationCommand(input: AcpConversationCommand): Promise<AcpCommandReceipt>;
  /** Read committed command evidence after ACK loss; null means unknown, never a resend. */
  queryConversationCommand(input: AcpCommandQuery): Promise<AcpCommandReceipt | null>;
  /** Isolated auxiliary run using the source conversation's current model; no source admission. */
  generateText(input: AcpGenerateText): Promise<AcpGeneratedText>;
  cancelGenerateText(input: AcpCancelGenerateText): Promise<void>;
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
  /** Latest target-Host ACP model metadata; never starts a session. */
  listAgentModels(input: AcpAgentModelsInput): Promise<AcpAgentModel[]>;
  listGeminiProviders(): Promise<AcpGeminiProviders>;
  updateGeminiProviders(input: AcpGeminiProvidersUpdate): Promise<AcpGeminiProviders>;
  manageAgent(input: AcpAgentManagement): Promise<AcpAgentInfo>;
  readAgentManagement(): Promise<AcpAgentManagementSnapshot>;
  cancelAgentOperation(input: AcpAgentOperationCancel): Promise<void>;
  onDynamicAgentManagement(): Event<AcpAgentManagementSnapshot>;
  onDynamicAgentOperation(operationId: string): Event<AcpAgentOperationEvent>;
  list(workspace: AcpWorkspace): Promise<AcpSession[]>;
  /** UI metadata only; never ships the conversation history. */
  listSummaries(workspace: AcpWorkspace): Promise<AcpSessionSummary[]>;
  onDynamicSessionSummaryChanged(workspace: AcpWorkspace): Event<AcpSessionSummaryChanged>;
  /** Durable V4 tail snapshot / cursor page; no Agent connection or command admission. */
  readConversation(input: AcpConversationRead): Promise<AcpConversationChange[]>;
  conversationRowsRange(input: AcpConversationRowsRange): Promise<V4ConversationRowsRangeResult>;
  onDynamicConversationChanged(input: AcpConversationTarget): Event<AcpConversationChange>;
  /** Persisted archive scopes on this Host only; no Agent connections. */
  listArchivedWorkspaces(): Promise<AcpWorkspace[]>;
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
   * Legacy/internal snapshot API. UI uses sendConversationCommand for bounded receipts.
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
  /** Exact live connection handle; never reconnects or cancels the whole turn. */
  stopTerminal(input: AcpTerminalControl): Promise<void>;
  cancelWorkflow(input: AcpWorkflowControl): Promise<void>;
  resumeWorkflow(input: AcpWorkflowControl): Promise<void>;
  getWorkflowArtifact(input: AcpWorkflowArtifactQuery): Promise<{ path: string }>;
  decide(input: AcpWorkspace & { id: string; requestId: string; optionId: string }): Promise<void>;
  /** Structured form response; accepted answers are never stored as conversation messages. */
  respondElicitation(
    input: AcpWorkspace & {
      id: string;
      requestId: string;
    } & import("@zcode/shared").AcpElicitationResponse,
  ): Promise<void>;
  /** Automatic pane cleanup may discard a draft but must never delete an admitted turn. */
  remove(input: AcpWorkspace & { id: string; provisionalOnly?: boolean }): Promise<void>;
  /** Conditional permanent deletion; restored or busy sessions are preserved. Retry pending cleanup. */
  removeArchived(input: AcpWorkspace & { id: string }): Promise<boolean>;
  /** Durable Host snapshots; coalesced stream updates may skip intermediate revisions. */
  onDynamicSessionChanged(workspace: AcpWorkspace): Event<AcpSessionChanged>;
}

export const IAcpService = createServiceDescriptor<IAcpService>(ServiceChannels.Acp);
