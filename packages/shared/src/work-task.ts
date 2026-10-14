import { z } from "zod";
import { forgeItemRequestSchema } from "./forge.js";
import { modelSelectionSchema } from "./model-selection.js";
import { workTaskChangeRecordSchema } from "./work-task-result.js";
import { acpAgentSchema, acpTextSourceSchema } from "./zcode-protocol/acp.js";
import { attachmentRefSchema } from "./zcode-protocol-v4/attachment-ref.js";
import { PROTOCOL_V4_LIMITS } from "./zcode-protocol-v4/core.js";
import {
  v4AttachmentBeginParamsSchema,
  v4AttachmentChunkParamsSchema,
} from "./zcode-protocol-v4/transport.js";

export const workTaskScopeSchema = z.object({
  workspacePath: z.string().trim().min(1),
  workspaceIdentity: z.string().trim().min(1).optional(),
  remoteSessionId: z.string().trim().min(1).optional(),
});
export type WorkTaskScope = z.infer<typeof workTaskScopeSchema>;

export const workTaskAttachmentSchema = attachmentRefSchema.omit({ previewRef: true }).extend({
  ref: z.string().min(1),
  fileName: v4AttachmentBeginParamsSchema.shape.fileName,
  mime: v4AttachmentBeginParamsSchema.shape.mime,
  bytes: z.number().int().min(0).max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
});
export type WorkTaskAttachment = z.infer<typeof workTaskAttachmentSchema>;

const workspaceFileSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !/^[\\/]|^[a-z]:|[\r\n]/i.test(path) &&
      !path.split(/[\\/]/).includes(".."),
    "Task file references must stay inside the workspace",
  );
const promptEditorStateSchema = z
  .string()
  .max(500_000)
  .refine((value) => {
    try {
      const state = JSON.parse(value);
      return (
        !!state && typeof state === "object" && !!state.root && Array.isArray(state.root.children)
      );
    } catch {
      return false;
    }
  }, "Invalid task editor state");
const promptAssetsShape = {
  attachments: z.array(workTaskAttachmentSchema).max(8).optional(),
  workspaceFiles: z.array(workspaceFileSchema).max(20).optional(),
  promptEditorState: promptEditorStateSchema.optional(),
};

export const workTaskAttachmentImportSchema = workTaskScopeSchema
  .extend({
    localPath: z.string().min(1),
    fileName: workTaskAttachmentSchema.shape.fileName,
    mime: workTaskAttachmentSchema.shape.mime,
  })
  .strict();
export type WorkTaskAttachmentImport = z.infer<typeof workTaskAttachmentImportSchema>;

export const workTaskAttachmentTargetSchema = workTaskScopeSchema
  .extend({
    uploadId: v4AttachmentBeginParamsSchema.shape.uploadId,
  })
  .strict();
export type WorkTaskAttachmentTarget = z.infer<typeof workTaskAttachmentTargetSchema>;
export const workTaskAttachmentBeginSchema = workTaskAttachmentTargetSchema
  .extend({
    fileName: v4AttachmentBeginParamsSchema.shape.fileName,
    mime: v4AttachmentBeginParamsSchema.shape.mime,
    totalBytes: v4AttachmentBeginParamsSchema.shape.totalBytes,
    totalChunks: v4AttachmentBeginParamsSchema.shape.totalChunks,
    checksum: v4AttachmentBeginParamsSchema.shape.checksum,
  })
  .strict()
  .refine((value) => (value.totalBytes === 0) === (value.totalChunks === 0));
export type WorkTaskAttachmentBegin = z.infer<typeof workTaskAttachmentBeginSchema>;
export const workTaskAttachmentChunkSchema = workTaskAttachmentTargetSchema
  .extend({
    chunkIndex: v4AttachmentChunkParamsSchema.shape.chunkIndex,
    dataBase64: z
      .string()
      .max(Math.ceil(PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes / 3) * 4)
      .refine(
        (value) =>
          value.length % 4 === 0 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
        "Invalid attachment base64",
      ),
  })
  .strict();
export type WorkTaskAttachmentChunk = z.infer<typeof workTaskAttachmentChunkSchema>;

export const workTaskExecutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("api"),
      modelSelection: modelSelectionSchema,
      mode: z.enum(["build", "edit", "plan", "yolo"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("acp"),
      agent: acpAgentSchema,
      config: z
        .array(
          z
            .object({
              configId: z.string().trim().min(1),
              value: z.union([z.string(), z.boolean()]),
            })
            .strict(),
        )
        .max(32),
    })
    .strict(),
]);
export type WorkTaskExecution = z.infer<typeof workTaskExecutionSchema>;

export const workTaskStatusSchema = z.enum([
  "todo",
  "queued",
  "preparing",
  "running",
  "awaiting_input",
  "review",
  "failed",
  "done",
  "canceled",
]);
export type WorkTaskStatus = z.infer<typeof workTaskStatusSchema>;
export const WORK_TASK_ACTIVE_STATUSES: readonly WorkTaskStatus[] = [
  "preparing",
  "running",
  "awaiting_input",
];

export const workTaskWorktreeSchema = z
  .object({
    rootPath: z.string().min(1),
    path: z.string().min(1),
    projectPath: z.string().min(1),
    branchName: z.string().min(1),
    baseCommit: z.string().min(1),
  })
  .strict();

export const workTaskMergeSchema = z
  .object({
    id: z.string().uuid(),
    projectPath: z.string().min(1),
    targetBranch: z.string().trim().min(1).max(1024),
    phase: z.enum([
      "queued",
      "preparing",
      "resolving",
      "awaiting_input",
      "applying",
      "merged",
      "failed",
      "canceled",
    ]),
    worktree: workTaskWorktreeSchema.optional(),
    session: z
      .object({ kind: z.enum(["api", "acp"]), id: z.string().min(1) })
      .strict()
      .optional(),
    sourceCommit: z.string().min(1).optional(),
    targetCommit: z.string().min(1).optional(),
    resultCommit: z.string().min(1).optional(),
    conflicts: z.array(z.string().min(1)).optional(),
    error: z.string().optional(),
  })
  .strict();
export type WorkTaskMerge = z.infer<typeof workTaskMergeSchema>;
export function isWorkTaskMerging(task: Pick<WorkTask, "merge">): boolean {
  return !!task.merge && !["merged", "failed", "canceled"].includes(task.merge.phase);
}

// 议题来源独立于提示词；范围始终从任务取得，禁止回写重定向到其他工作区。
export const workTaskSourceSchema = forgeItemRequestSchema
  .omit({ workspacePath: true, workspaceIdentity: true })
  .extend({ url: z.string().url().max(8192), title: z.string().max(256) })
  .strict();
export type WorkTaskSource = z.infer<typeof workTaskSourceSchema>;
export const workTaskForgeOptionsSchema = z
  .object({
    closeIssue: z.boolean(),
    comment: z.string().trim().min(1).max(60_000).optional(),
  })
  .strict();
export type WorkTaskForgeOptions = z.infer<typeof workTaskForgeOptionsSchema>;
const forgeStepSchema = z.enum(["pending", "sending", "done", "skipped", "failed", "uncertain"]);
export const workTaskForgeWritebackSchema = workTaskForgeOptionsSchema
  .extend({
    id: z.string().uuid(),
    runSeq: z.number().int().nonnegative(),
    commentState: forgeStepSchema,
    closeState: forgeStepSchema,
    error: z.string().max(256).optional(),
    owner: z.string().uuid().optional(),
    leaseUntil: z.number().optional(),
    records: workTaskChangeRecordSchema.optional(),
    recordsFinalized: z.boolean().optional(),
  })
  .strict();
export type WorkTaskForgeWriteback = z.infer<typeof workTaskForgeWritebackSchema>;
export function isWorkTaskForgePending(task: Pick<WorkTask, "forgeWriteback">): boolean {
  const state = task.forgeWriteback;
  return (
    !!state && [state.commentState, state.closeState].some((s) => s !== "done" && s !== "skipped")
  );
}
/** 有效同步租约才表示正在同步；失败收据或过期 owner 不应一直阻止清理。 */
export function isWorkTaskForgeSyncing(
  task: Pick<WorkTask, "forgeWriteback">,
  now = Date.now(),
): boolean {
  const state = task.forgeWriteback;
  return !!state?.owner && (state.leaseUntil ?? 0) > now;
}
export function workTaskSourceKey(
  source: Pick<WorkTaskSource, "repositoryKey" | "kind" | "number">,
): string {
  return JSON.stringify([source.repositoryKey, source.kind, source.number]);
}

export const workTaskSchema = workTaskScopeSchema
  .extend({
    ...promptAssetsShape,
    id: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(100_000),
    execution: workTaskExecutionSchema,
    source: workTaskSourceSchema.optional(),
    forgeWriteback: workTaskForgeWritebackSchema.optional(),
    sourceBranch: z.string().trim().min(1).max(1024).optional(),
    /** Missing on legacy tasks means isolated worktree execution. */
    useWorktree: z.boolean().optional(),
    directBranch: z.string().trim().min(1).max(1024).optional(),
    status: workTaskStatusSchema,
    archived: z.boolean(),
    runSeq: z.number().int().nonnegative(),
    runText: z.string(),
    runUsesPromptAssets: z.boolean().optional(),
    commandId: z.string().min(1),
    sessionRequestId: z.string().uuid(),
    session: z
      .object({ kind: z.enum(["api", "acp"]), id: z.string().min(1) })
      .strict()
      .optional(),
    worktree: workTaskWorktreeSchema.optional(),
    worktreeCleanup: z
      .object({
        id: z.string().uuid(),
        phase: z.enum(["running", "failed"]),
        error: z.string().optional(),
      })
      .strict()
      .optional(),
    merge: workTaskMergeSchema.optional(),
    failureReason: z.string().optional(),
    completion: z.enum(["accepted_without_merge", "merged"]).optional(),
    stopPending: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type WorkTask = z.infer<typeof workTaskSchema>;
export const workTaskCreateSchema = workTaskScopeSchema
  .extend({
    ...promptAssetsShape,
    title: workTaskSchema.shape.title,
    prompt: workTaskSchema.shape.prompt,
    execution: workTaskExecutionSchema,
    source: workTaskSchema.shape.source,
    sourceBranch: workTaskSchema.shape.sourceBranch,
    useWorktree: workTaskSchema.shape.useWorktree,
  })
  .strict();
export type WorkTaskCreate = z.infer<typeof workTaskCreateSchema>;

/** Only persisted execution bindings may select a conversation/tool directory. */
export function workTaskExecutionPath(task: WorkTask): string | undefined {
  return task.useWorktree === false && task.directBranch ? task.workspacePath : task.worktree?.path;
}
export const workTaskTargetSchema = workTaskScopeSchema.extend({ id: z.string().min(1) }).strict();
export type WorkTaskTarget = z.infer<typeof workTaskTargetSchema>;
export const workTaskResultRequestSchema = workTaskTargetSchema
  .extend({
    requestId: z.string().uuid(),
    runSeq: z.number().int().nonnegative(),
    mode: z.enum(["merge", "accept"]),
    locale: z.enum(["zh-CN", "en-US"]),
  })
  .strict();
export type WorkTaskResultRequest = z.infer<typeof workTaskResultRequestSchema>;
export const workTaskResultCancelSchema = workTaskResultRequestSchema.omit({
  mode: true,
  locale: true,
});
export type WorkTaskResultCancel = z.infer<typeof workTaskResultCancelSchema>;
export const workTaskResultSourceRequestSchema = workTaskResultCancelSchema.omit({
  requestId: true,
});
export type WorkTaskResultSourceRequest = z.infer<typeof workTaskResultSourceRequestSchema>;
export const workTaskResultSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api"), selection: modelSelectionSchema }).strict(),
  acpTextSourceSchema.extend({ kind: z.literal("acp") }).strict(),
]);
export type WorkTaskResultSource = z.infer<typeof workTaskResultSourceSchema>;
export const workTaskResultDraftSchema = z
  .object({ text: z.string().trim().min(1).max(12_000), source: workTaskResultSourceSchema })
  .strict();
export type WorkTaskResultDraft = z.infer<typeof workTaskResultDraftSchema>;
export const workTaskCompleteSchema = workTaskTargetSchema
  .extend({
    forge: workTaskForgeOptionsSchema.optional(),
    resendComment: z.boolean().optional(),
  })
  .strict();
export type WorkTaskComplete = z.infer<typeof workTaskCompleteSchema>;
export const workTaskUpdateSchema = workTaskCreateSchema
  .omit({ source: true })
  .extend({ id: z.string().min(1) })
  .strict();
export type WorkTaskUpdate = z.infer<typeof workTaskUpdateSchema>;
export const workTaskStartSchema = workTaskTargetSchema
  .extend({ feedback: z.string().trim().min(1).max(100_000).optional() })
  .strict();
export type WorkTaskStart = z.infer<typeof workTaskStartSchema>;
export const workTaskMergeRequestSchema = workTaskTargetSchema
  .extend({
    targetBranch: workTaskMergeSchema.shape.targetBranch,
    forge: workTaskForgeOptionsSchema.optional(),
  })
  .strict();
export type WorkTaskMergeRequest = z.infer<typeof workTaskMergeRequestSchema>;
export const workTaskListSchema = workTaskScopeSchema
  .extend({ includeArchived: z.boolean().optional() })
  .strict();
export const workTaskArchiveSchema = workTaskTargetSchema
  .extend({ archived: z.boolean(), removeWorktree: z.boolean().optional() })
  .strict()
  .refine((input) => !input.removeWorktree || input.archived);
export type WorkTaskArchive = z.infer<typeof workTaskArchiveSchema>;
/** Legacy settings validation; retained for compatibility, not an execution limit. */
export const workTaskConcurrencySchema = workTaskScopeSchema
  .extend({ concurrency: z.number().int().min(1).max(8) })
  .strict();

export interface WorkTaskBoard {
  tasks: WorkTask[];
  /** @deprecated Saved compatibility value; tasks have no project concurrency limit. */
  concurrency: number;
}
export interface WorkTaskEvent {
  sequence: number;
  taskId: string;
  runSeq: number;
  at: number;
  type: string;
  message?: string;
}
