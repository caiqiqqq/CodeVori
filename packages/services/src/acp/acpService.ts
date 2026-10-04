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
  type AcpPromptInput,
  type AcpStopInput,
  type AcpSession,
  type AcpDiagnosticEvent,
  type AcpSessionRowUpdate,
  type AcpSessionSearchInput,
  type AcpSessionSearchItem,
  type AcpSessionChanged,
  type AcpWorkspace,
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
  /** Exact target-Host snapshot path; never a native task or Agent log path. */
  getSessionFilePath(input: AcpWorkspace & { id: string }): Promise<string>;
  /** Exact target-Host per-session metadata log path; never an Agent-owned log. */
  getDiagnosticLogPath(input: AcpWorkspace & { id: string }): Promise<string>;
  /** Bounded, metadata-only ACP events from the same log. */
  getExecutionTrace(input: AcpWorkspace & { id: string }): Promise<AcpDiagnosticEvent[]>;
  /** Mutates only the target Host's durable ACP sidebar metadata. */
  updateRow(input: AcpSessionRowUpdate): Promise<AcpSession>;
  /** Reconnects an existing display snapshot so its Agent-owned options are current. */
  refresh(input: AcpWorkspace & { id: string }): Promise<AcpSession>;
  /** Optional preconnection returns an in-memory draft; the first accepted prompt persists it. */
  create(input: AcpCreateInput): Promise<AcpSession>;
  prompt(input: AcpWorkspace & { id: string } & AcpPromptInput): Promise<AcpSession>;
  setGoal(input: AcpWorkspace & { id: string; goal: string | null }): Promise<AcpSession>;
  setConfigOption(
    input: AcpWorkspace & { id: string; configId: string; value: string | boolean },
  ): Promise<AcpSession>;
  stop(input: AcpStopInput): Promise<void>;
  cancelWorkflow(input: AcpWorkflowControl): Promise<void>;
  resumeWorkflow(input: AcpWorkflowControl): Promise<void>;
  getWorkflowArtifact(input: AcpWorkflowArtifactQuery): Promise<{ path: string }>;
  decide(input: AcpWorkspace & { id: string; requestId: string; optionId: string }): Promise<void>;
  /** Automatic pane cleanup may discard a draft but must never delete an admitted turn. */
  remove(input: AcpWorkspace & { id: string; provisionalOnly?: boolean }): Promise<void>;
  onDynamicSessionChanged(workspace: AcpWorkspace): Event<AcpSessionChanged>;
}

export const IAcpService = createServiceDescriptor<IAcpService>(ServiceChannels.Acp);
