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
  type WorkTaskMerge,
  type WorkTaskMergeRequest,
  type WorkTaskAttachment,
  type WorkTaskAttachmentImport,
  type WorkTaskAttachmentBegin,
  type WorkTaskAttachmentChunk,
  type WorkTaskAttachmentTarget,
  type WorkTaskArchive,
  type WorkTaskResultRequest,
  type WorkTaskResultCancel,
  type WorkTaskResultDraft,
  type WorkTaskResultSource,
  type WorkTaskResultSourceRequest,
  type WorkTaskChangeRecord,
} from "@zcode/shared";
import type {
  V4AttachmentBeginResult,
  V4AttachmentChunkResult,
  V4AttachmentPutResult,
} from "@zcode/shared/zcode-protocol-v4";
import type { Event, IDisposable } from "@zcode/rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface IWorkTaskService {
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
  update(input: WorkTaskUpdate): Promise<WorkTask>;
  start(input: WorkTaskStart): Promise<WorkTask>;
  startAll(input: WorkTaskScope): Promise<void>;
  cancel(input: WorkTaskTarget): Promise<WorkTask>;
  complete(input: WorkTaskComplete): Promise<WorkTask>;
  merge(input: WorkTaskMergeRequest): Promise<WorkTask>;
  /** removeWorktree returns durable admission; list/events carry cleanup outcome. */
  archive(input: WorkTaskArchive): Promise<WorkTask>;
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
