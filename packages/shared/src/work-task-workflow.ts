import { z } from "zod";
import {
  workTaskExecutionSchema,
  workTaskScopeSchema,
  workTaskTargetSchema,
  workTaskWorktreeSchema,
} from "./work-task-core.js";
import type { WorkTask } from "./work-task.js";

export const workTaskWorkflowStageSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    owner: z.string().trim().min(1).max(120).optional(),
    instructions: z.string().max(20_000),
    nextStageId: z.string().trim().min(1).max(64).optional(),
    returnStageId: z.string().trim().min(1).max(64).optional(),
    execution: workTaskExecutionSchema.optional(),
    status: z
      .enum(["backlog", "todo", "active", "review", "blocked", "done", "canceled"])
      .optional(),
    enabled: z.boolean().optional(),
    handoff: z.enum(["none", "agent", "member"]).optional(),
  })
  .strict();
export type WorkTaskWorkflowStage = z.infer<typeof workTaskWorkflowStageSchema>;

export const workTaskWorkflowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    initialStageId: z.string().trim().min(1).max(64).optional(),
    stages: z.array(workTaskWorkflowStageSchema).min(2).max(12),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const indexes = new Map<string, number>();
    workflow.stages.forEach((stage, index) => {
      if (indexes.has(stage.id))
        ctx.addIssue({
          code: "custom",
          path: ["stages", index, "id"],
          message: "Duplicate stage ID",
        });
      indexes.set(stage.id, index);
    });
    workflow.stages.forEach((stage, index) => {
      const expectedNext = workflow.stages[index + 1]?.id;
      if (!workflow.initialStageId && stage.nextStageId !== expectedNext)
        ctx.addIssue({
          code: "custom",
          path: ["stages", index, "nextStageId"],
          message: "Stages must point to the next ordered stage",
        });
      if (stage.returnStageId) {
        const targetIndex = indexes.get(stage.returnStageId);
        if (
          targetIndex === undefined ||
          targetIndex >= index ||
          workflow.stages[targetIndex]?.enabled === false
        )
          ctx.addIssue({
            code: "custom",
            path: ["stages", index, "returnStageId"],
            message: "Return stage must reference an earlier stage",
          });
      }
      if (stage.nextStageId) {
        const targetIndex = indexes.get(stage.nextStageId);
        if (
          targetIndex === undefined ||
          targetIndex <= index ||
          workflow.stages[targetIndex]?.enabled === false
        )
          ctx.addIssue({
            code: "custom",
            path: ["stages", index, "nextStageId"],
            message: "Invalid completion target",
          });
      }
      if (stage.handoff === "agent" && !stage.execution)
        ctx.addIssue({
          code: "custom",
          path: ["stages", index, "execution"],
          message: "Agent execution is required",
        });
      if (stage.handoff === "member" && !stage.owner)
        ctx.addIssue({
          code: "custom",
          path: ["stages", index, "owner"],
          message: "Member name is required",
        });
    });
    if (workflow.initialStageId) {
      const initial = workflow.stages.find((stage) => stage.id === workflow.initialStageId);
      if (!initial || initial.enabled === false || initial.status !== "todo")
        ctx.addIssue({
          code: "custom",
          path: ["initialStageId"],
          message: "The enabled Todo step must be the start",
        });
      for (const status of ["todo", "done", "canceled"] as const) {
        const matching = workflow.stages.filter((stage) => stage.status === status);
        if (matching.length !== 1 || matching[0]?.enabled === false)
          ctx.addIssue({
            code: "custom",
            path: ["stages"],
            message: `One enabled ${status} step is required`,
          });
      }
      for (const status of ["backlog", "blocked"] as const) {
        if (workflow.stages.filter((stage) => stage.status === status).length > 1)
          ctx.addIssue({ code: "custom", path: ["stages"], message: `Duplicate ${status} step` });
      }
      const rank = { backlog: 0, todo: 1, active: 2, review: 2, blocked: 3, done: 4, canceled: 5 };
      workflow.stages.forEach((stage, index) => {
        if ((stage.handoff ?? "none") !== "agent" && stage.execution)
          ctx.addIssue({
            code: "custom",
            path: ["stages", index, "execution"],
            message: "Passive steps cannot select an executor",
          });
        const prior = workflow.stages[index - 1];
        if (!stage.status || (prior?.status && rank[stage.status] < rank[prior.status]))
          ctx.addIssue({
            code: "custom",
            path: ["stages", index, "status"],
            message: "Invalid status order",
          });
        if (stage.enabled === false && stage.status !== "backlog" && stage.status !== "blocked")
          ctx.addIssue({
            code: "custom",
            path: ["stages", index, "enabled"],
            message: "Only Backlog and Blocked may be excluded",
          });
        if (
          (stage.status === "done" || stage.status === "canceled") &&
          ((stage.handoff && stage.handoff !== "none") || stage.nextStageId || stage.returnStageId)
        )
          ctx.addIssue({
            code: "custom",
            path: ["stages", index],
            message: "Terminal steps cannot hand off or advance",
          });
      });
    }
  });
export type WorkTaskWorkflow = z.infer<typeof workTaskWorkflowSchema>;
export const workTaskWorkflowSaveSchema = workTaskScopeSchema
  .extend({
    expectedRevision: z.number().int().nonnegative(),
    workflowId: z.string().uuid().nullable(),
  })
  .strict();
export type WorkTaskWorkflowSave = z.infer<typeof workTaskWorkflowSaveSchema>;
export interface WorkTaskWorkflowConfig {
  workflow: WorkTaskWorkflow | null;
  revision: number;
}
export const workTaskWorkflowDefinitionSaveSchema = z
  .object({
    workflow: workTaskWorkflowSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type WorkTaskWorkflowDefinitionSave = z.infer<typeof workTaskWorkflowDefinitionSaveSchema>;
export const workTaskWorkflowDefinitionDeleteSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type WorkTaskWorkflowDefinitionDelete = z.infer<
  typeof workTaskWorkflowDefinitionDeleteSchema
>;
export interface WorkTaskWorkflowDefinition {
  workflow: WorkTaskWorkflow;
  revision: number;
  projectKeys: string[];
}

export const conversationWorkflowTargetSchema = workTaskScopeSchema
  .extend({ kind: z.enum(["api", "acp"]), sessionId: z.string().min(1) })
  .strict();
export type ConversationWorkflowTarget = z.infer<typeof conversationWorkflowTargetSchema>;

export const conversationWorkflowStateSchema = z
  .object({
    definition: workTaskWorkflowSchema,
    currentStageId: z.string().trim().min(1).max(64),
    owner: z.string().trim().min(1).max(120).optional(),
    revision: z.number().int().positive(),
    history: z.array(
      z
        .object({
          stageId: z.string().trim().min(1).max(64),
          stageName: z.string().trim().min(1).max(80),
          owner: z.string().trim().min(1).max(120).optional(),
          targetStageId: z.string().trim().min(1).max(64),
          handoffNote: z.string().trim().min(1).max(12_000).optional(),
          transitionedAt: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((state, ctx) => {
    const stages = new Set(state.definition.stages.map((stage) => stage.id));
    if (!state.definition.initialStageId)
      ctx.addIssue({ code: "custom", path: ["definition"], message: "Status workflow required" });
    if (!stages.has(state.currentStageId))
      ctx.addIssue({ code: "custom", path: ["currentStageId"], message: "Unknown current stage" });
    state.history.forEach((entry, index) => {
      if (!stages.has(entry.stageId) || !stages.has(entry.targetStageId))
        ctx.addIssue({
          code: "custom",
          path: ["history", index],
          message: "Unknown history stage",
        });
    });
  });
export type ConversationWorkflowState = z.infer<typeof conversationWorkflowStateSchema>;
export interface ConversationWorkflowRecord extends ConversationWorkflowTarget {
  state: ConversationWorkflowState;
}

export const conversationWorkflowAttachSchema = conversationWorkflowTargetSchema;
export type ConversationWorkflowAttach = z.infer<typeof conversationWorkflowAttachSchema>;

export const conversationWorkflowTransitionSchema = conversationWorkflowTargetSchema
  .extend({
    expectedRevision: z.number().int().positive(),
    expectedStageId: z.string().trim().min(1).max(64),
    targetStageId: z.string().trim().min(1).max(64),
    handoffNote: z.string().trim().min(1).max(12_000).optional(),
  })
  .strict();
export type ConversationWorkflowTransition = z.infer<typeof conversationWorkflowTransitionSchema>;

export const workTaskWorkflowStateSchema = z
  .object({
    definition: workTaskWorkflowSchema,
    currentStageId: z.string().trim().min(1).max(64),
    owner: z.string().trim().min(1).max(120).optional(),
    history: z.array(
      z
        .object({
          stageId: z.string().trim().min(1).max(64),
          stageName: z.string().trim().min(1).max(80),
          owner: z.string().trim().min(1).max(120).optional(),
          session: z
            .object({ kind: z.enum(["api", "acp"]), id: z.string().min(1) })
            .strict()
            .optional(),
          execution: workTaskExecutionSchema,
          worktree: workTaskWorktreeSchema.optional(),
          directBranch: z.string().trim().min(1).max(1024).optional(),
          runSeq: z.number().int().nonnegative(),
          targetStageId: z.string().trim().min(1).max(64),
          handoffNote: z.string().trim().min(1).max(12_000).optional(),
          transitionedAt: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((state, ctx) => {
    const stages = new Set(state.definition.stages.map((stage) => stage.id));
    if (!stages.has(state.currentStageId))
      ctx.addIssue({ code: "custom", path: ["currentStageId"], message: "Unknown current stage" });
    state.history.forEach((entry, index) => {
      if (!stages.has(entry.stageId) || !stages.has(entry.targetStageId))
        ctx.addIssue({
          code: "custom",
          path: ["history", index],
          message: "Unknown history stage",
        });
      if (entry.session && entry.session.kind !== entry.execution.kind)
        ctx.addIssue({
          code: "custom",
          path: ["history", index, "session"],
          message: "History executor mismatch",
        });
    });
  });

export const workTaskWorkflowTransitionSchema = workTaskTargetSchema
  .extend({
    expectedRunSeq: z.number().int().nonnegative(),
    expectedStageId: z.string().trim().min(1).max(64),
    targetStageId: z.string().trim().min(1).max(64),
    handoffNote: z.string().trim().min(1).max(12_000).optional(),
  })
  .strict();
export type WorkTaskWorkflowTransition = z.infer<typeof workTaskWorkflowTransitionSchema>;
export function currentWorkTaskWorkflowStage(task: Pick<WorkTask, "workflow">) {
  return task.workflow?.definition.stages.find(
    (stage) => stage.id === task.workflow?.currentStageId,
  );
}

export function isWorkTaskWorkflowFinalStage(task: Pick<WorkTask, "workflow">): boolean {
  if (!task.workflow) return true;
  const stage = currentWorkTaskWorkflowStage(task);
  return !!stage && (stage.status ? stage.status === "done" : !stage.nextStageId);
}
