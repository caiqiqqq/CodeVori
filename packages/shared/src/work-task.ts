import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";
import { acpAgentSchema } from "./zcode-protocol/acp.js";

export const workTaskScopeSchema = z.object({
  workspacePath: z.string().trim().min(1),
  workspaceIdentity: z.string().trim().min(1).optional(),
  remoteSessionId: z.string().trim().min(1).optional(),
});
export type WorkTaskScope = z.infer<typeof workTaskScopeSchema>;

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

export const workTaskSchema = workTaskScopeSchema
  .extend({
    id: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(100_000),
    execution: workTaskExecutionSchema,
    status: workTaskStatusSchema,
    archived: z.boolean(),
    runSeq: z.number().int().nonnegative(),
    runText: z.string(),
    commandId: z.string().min(1),
    sessionRequestId: z.string().uuid(),
    session: z
      .object({ kind: z.enum(["api", "acp"]), id: z.string().min(1) })
      .strict()
      .optional(),
    worktree: workTaskWorktreeSchema.optional(),
    failureReason: z.string().optional(),
    completion: z.literal("accepted_without_merge").optional(),
    stopPending: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type WorkTask = z.infer<typeof workTaskSchema>;
export const workTaskCreateSchema = workTaskScopeSchema
  .extend({
    title: workTaskSchema.shape.title,
    prompt: workTaskSchema.shape.prompt,
    execution: workTaskExecutionSchema,
  })
  .strict();
export type WorkTaskCreate = z.infer<typeof workTaskCreateSchema>;
export const workTaskTargetSchema = workTaskScopeSchema.extend({ id: z.string().min(1) }).strict();
export type WorkTaskTarget = z.infer<typeof workTaskTargetSchema>;
export const workTaskUpdateSchema = workTaskCreateSchema.extend({ id: z.string().min(1) }).strict();
export type WorkTaskUpdate = z.infer<typeof workTaskUpdateSchema>;
export const workTaskStartSchema = workTaskTargetSchema
  .extend({ feedback: z.string().trim().min(1).max(100_000).optional() })
  .strict();
export type WorkTaskStart = z.infer<typeof workTaskStartSchema>;
export const workTaskListSchema = workTaskScopeSchema
  .extend({ includeArchived: z.boolean().optional() })
  .strict();
export const workTaskArchiveSchema = workTaskTargetSchema
  .extend({ archived: z.boolean() })
  .strict();
export const workTaskConcurrencySchema = workTaskScopeSchema
  .extend({ concurrency: z.number().int().min(1).max(8) })
  .strict();

export interface WorkTaskBoard {
  tasks: WorkTask[];
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
