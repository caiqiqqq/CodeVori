import {
  ServiceChannels,
  type WorkTask,
  type WorkTaskBoard,
  type WorkTaskCreate,
  type WorkTaskEvent,
  type WorkTaskScope,
  type WorkTaskStart,
  type WorkTaskTarget,
  type WorkTaskComplete,
  type ForgeItemRequest,
  type ForgePageRequest,
  type ForgeCommentRequest,
  type ForgeStateRequest,
  type ForgeItem,
  type ForgeComment,
  type ForgePage,
  type WorkTaskUpdate,
  type WorkTaskRename,
  type WorkTaskMerge,
  type WorkTaskMergeRequest,
  type WorkTaskAttachment,
  type WorkTaskAttachmentImport,
  type WorkTaskAttachmentBegin,
  type WorkTaskAttachmentChunk,
  type WorkTaskAttachmentTarget,
  type WorkTaskArchive,
  type WorkTaskAcceptBranch,
  type WorkTaskWorktreeInspection,
  type WorkTaskResultRequest,
  type WorkTaskResultCancel,
  type WorkTaskResultDraft,
  type WorkTaskResultSource,
  type WorkTaskResultSourceRequest,
  type WorkTaskChangeRecord,
  type WorkTaskWorkflowDefinition,
  type WorkTaskWorkflowDefinitionSave,
  type WorkTaskWorkflowDefinitionDelete,
  type WorkTaskWorkflowConfig,
  type WorkTaskWorkflowSave,
  type WorkTaskWorkflowTransition,
  type ConversationWorkflowAttach,
  type ConversationWorkflowRecord,
  type ConversationWorkflowTransition,
  type RepositoryIssueSummaryRequest,
  type RepositoryIssueSummary,
  type ForgeRepositoryRequest,
  type ForgeRepositoryInfo,
  type ForgeListRequest,
  type ForgeItemList,
} from "@zcode/shared";
import type {
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentPutResult,
} from "@zcode/shared/zcode-protocol-v4";
import type { Event, IDisposable } from "@zcode/rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface IWorkTaskService {
  /** Host 派生议题及合并请求只读数量；条目状态归 Forge，任务关联归 WorkTaskRepo。 */
  getRepositoryIssueSummary(input: RepositoryIssueSummaryRequest): Promise<RepositoryIssueSummary>;
  getResultSource(input: WorkTaskResultSourceRequest): Promise<WorkTaskResultSource>;
  generateResult(input: WorkTaskResultRequest): Promise<WorkTaskResultDraft>;
  cancelResult(input: WorkTaskResultCancel): Promise<void>;
  attachmentImport(input: WorkTaskAttachmentImport): Promise<WorkTaskAttachment>;
  attachmentBegin(input: WorkTaskAttachmentBegin): Promise<V4AttachmentBeginResult>;
  attachmentChunk(input: WorkTaskAttachmentChunk): Promise<V4AttachmentChunkResult>;
  attachmentCommit(input: WorkTaskAttachmentTarget): Promise<V4AttachmentPutResult>;
  attachmentAbort(input: WorkTaskAttachmentTarget): Promise<void>;
  list(input: WorkTaskScope & { includeArchived?: boolean }): Promise<WorkTaskBoard>;
  create(input: WorkTaskCreate): Promise<WorkTask>;
  /** Host 目录定义与项目引用分别 CAS；新任务快照化，设置编辑不入队。 */
  listWorkflows(): Promise<WorkTaskWorkflowDefinition[]>;
  saveWorkflowDefinition(
    input: WorkTaskWorkflowDefinitionSave,
  ): Promise<WorkTaskWorkflowDefinition>;
  deleteWorkflowDefinition(input: WorkTaskWorkflowDefinitionDelete): Promise<void>;
  onDynamicWorkflowsChanged(): Event<void>;
  /** 只选择目录 ID；远程 scope 不允许回落到本地引用。 */
  saveWorkflow(input: WorkTaskWorkflowSave): Promise<WorkTaskWorkflowConfig>;
  /** 比较 runSeq/状态快照；仅 Agent 入口入队，Keep/Member 保留原会话。 */
  transitionWorkflow(input: WorkTaskWorkflowTransition): Promise<WorkTask>;
  /** 普通 API/ACP 会话显式采用项目工作流；只保存业务状态，不影响会话执行。 */
  attachConversationWorkflow(
    input: ConversationWorkflowAttach,
  ): Promise<ConversationWorkflowRecord>;
  transitionConversationWorkflow(
    input: ConversationWorkflowTransition,
  ): Promise<ConversationWorkflowRecord>;
  update(input: WorkTaskUpdate): Promise<WorkTask>;
  /** 元数据改名适用于运行中任务，仅改标题，不编辑或重新执行草稿。 */
  rename(input: WorkTaskRename): Promise<WorkTask>;
  start(input: WorkTaskStart): Promise<WorkTask>;
  startAll(input: WorkTaskScope): Promise<void>;
  cancel(input: WorkTaskTarget): Promise<WorkTask>;
  complete(input: WorkTaskComplete): Promise<WorkTask>;
  merge(input: WorkTaskMergeRequest): Promise<WorkTask>;
  /** removeWorktree returns durable admission; list/events carry cleanup outcome. */
  /** removeWorktree 在有效议题同步租约期间拒绝为 work-task.forge-busy；本地完成事实不撤销。 */
  archive(input: WorkTaskArchive): Promise<WorkTask>;
  inspectWorktree(input: WorkTaskTarget): Promise<WorkTaskWorktreeInspection>;
  acceptWorktreeBranch(input: WorkTaskAcceptBranch): Promise<WorkTask>;
  /** @deprecated Compatibility setting only; does not limit task execution. */
  setConcurrency(input: WorkTaskScope & { concurrency: number }): Promise<void>;
  getEvents(input: WorkTaskTarget): Promise<WorkTaskEvent[]>;
  onDynamicChanged(input: WorkTaskScope): Event<void>;
}
export const IWorkTaskService = createServiceDescriptor<IWorkTaskService>(ServiceChannels.WorkTask);

/** 任务执行和辅助摘要共享同一个本地 Host 准入边界。 */
export function assertWorkTaskLocal(scope: WorkTaskScope, allowExecution?: boolean) {
  if (allowExecution === false || scope.workspaceIdentity || scope.remoteSessionId)
    throw new Error("work-task.remote-unsupported");
}

export interface WorkTaskExecutionUpdate {
  status?: "running" | "awaiting_input";
  session?: NonNullable<WorkTask["session"]>;
  worktree?: NonNullable<WorkTask["worktree"]>;
  directBranch?: string;
  merge?: WorkTaskMerge;
}
export interface WorkTaskExecutionContext {
  readonly signal: AbortSignal;
  /** False means this run lost its lease or was canceled; no further commands may be sent. */
  update(patch: WorkTaskExecutionUpdate): Promise<boolean>;
}
export interface WorkTaskExecutionPort {
  execute(task: WorkTask, context: WorkTaskExecutionContext): Promise<void>;
}

export interface WorkTaskMergePort {
  validate(task: WorkTask, targetBranch: string): Promise<{ projectPath: string }>;
  execute(task: WorkTask, context: WorkTaskExecutionContext): Promise<void>;
}

export interface WorkTaskConversationEvent {
  commandId: string;
  startedAt: number;
  status: "running" | "awaiting_input" | "review" | "failed";
  error?: string;
  foregroundExecutionId?: string;
}

/** Passive facts from an already-bound conversation; never sends or replays an input. */
export interface WorkTaskConversationPort {
  watch(task: WorkTask, listener: (event: WorkTaskConversationEvent) => void): IDisposable;
  stop(task: WorkTask, event: WorkTaskConversationEvent): Promise<void>;
}

/** Existing Forge adapter capabilities injected by the Host; no runtime/credential ownership here. */
export interface WorkTaskForgePort {
  getForgeItem(input: ForgeItemRequest): Promise<ForgeItem>;
  listForgeComments(input: ForgePageRequest): Promise<ForgePage<ForgeComment>>;
  createForgeComment(input: ForgeCommentRequest): Promise<void>;
  setForgeItemState(input: ForgeStateRequest): Promise<void>;
}

export interface WorkTaskRepositoryIssuesPort {
  getForgeRepository(input: ForgeRepositoryRequest): Promise<ForgeRepositoryInfo>;
  listForgeItems(input: ForgeListRequest): Promise<ForgeItemList>;
}

/** Host-injected read-only evidence and text generation; never sends task conversation input. */
export interface WorkTaskResultPort {
  source(task: WorkTask): Promise<WorkTaskResultSource>;
  generate(
    task: WorkTask,
    input: WorkTaskResultRequest,
    signal: AbortSignal,
  ): Promise<WorkTaskResultDraft>;
  records(task: WorkTask, targetBranch?: string): Promise<WorkTaskChangeRecord>;
}
