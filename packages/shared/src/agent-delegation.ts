import { z } from "zod";
import { workTaskScopeSchema, workTaskExecutionSchema, workTaskSchema } from "./work-task.js";
import { acpAgentAvailabilitySchema } from "./zcode-protocol/acp.js";

export const delegationApiAgentSchema = z
  .object({
    kind: z.literal("api"),
    providerName: z.string().min(1),
    execution: workTaskExecutionSchema.options[0],
    reasoningLevels: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type DelegationApiAgent = z.infer<typeof delegationApiAgentSchema>;
export const delegationAgentSchema = z.union([
  acpAgentAvailabilitySchema.extend({ kind: z.literal("acp").default("acp") }),
  delegationApiAgentSchema,
]);
export const delegationAgentsSchema = z.array(delegationAgentSchema);
export type DelegationAgent = z.infer<typeof delegationAgentSchema>;

export function getDelegationAgentReference(target: DelegationAgent): string {
  if (target.kind === "acp") return `acp.${target.agent}`;
  const hex = (value: string) =>
    Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  const selection = target.execution.modelSelection;
  return `api.${hex(selection.providerId)}.${hex(selection.modelId)}`;
}

export const delegationParentSchema = workTaskScopeSchema
  .extend({
    kind: z.enum(["api", "acp"]),
    sessionId: z.string().trim().min(1),
  })
  .strict();
export type DelegationParent = z.infer<typeof delegationParentSchema>;
export const delegationSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    concurrency: z.number().int().min(1).max(8).default(2),
    allowNested: z.boolean().default(false),
    maxDepth: z.number().int().min(1).max(8).default(2),
    completedCacheMaxMb: z.number().int().min(0).max(4_294_967_295).default(512),
  })
  .strict()
  .refine((settings) => !settings.allowNested || settings.maxDepth <= settings.concurrency, {
    message: "delegation.nesting-capacity",
    path: ["maxDepth"],
  });
export type DelegationSettings = z.infer<typeof delegationSettingsSchema>;
export const delegationResultSchema = z
  .object({
    conclusion: z.string().max(100_000),
    changedFiles: z.array(z.string().max(4096)).max(500).default([]),
    tests: z.array(z.string().max(10_000)).max(100).default([]),
    risks: z.array(z.string().max(10_000)).max(100).default([]),
    blockers: z.array(z.string().max(10_000)).max(100).default([]),
    structured: z.boolean().default(true),
  })
  .strict();
export type DelegationResult = z.infer<typeof delegationResultSchema>;
export const delegationStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "awaiting_input",
  "completed",
  "failed",
  "interrupted",
  "canceled",
]);
export const delegationCreateSchema = delegationParentSchema
  .extend({
    requestId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    task: z.string().trim().min(1).max(100_000),
    background: z.string().max(100_000).default(""),
    constraints: z.string().max(20_000).default(""),
    expectedResult: z.string().max(20_000).default(""),
    execution: workTaskExecutionSchema,
    intent: z.enum(["analysis", "edit"]).default("edit"),
    workspaceFiles: workTaskSchema.shape.workspaceFiles,
    attachments: workTaskSchema.shape.attachments,
    dependsOn: z.array(z.string().uuid()).max(32).default([]),
  })
  .strict();
export type DelegationCreate = z.infer<typeof delegationCreateSchema>;
export const delegationTargetSchema = delegationParentSchema
  .extend({ id: z.string().uuid() })
  .strict();
export type DelegationTarget = z.infer<typeof delegationTargetSchema>;
export const delegationRedeliverSchema = delegationTargetSchema.extend({
  attemptSequence: z.number().int().positive().optional(),
});
export type DelegationRedeliver = z.infer<typeof delegationRedeliverSchema>;
export const delegationFollowUpSchema = delegationTargetSchema
  .extend({
    requestId: z.string().uuid(),
    task: delegationCreateSchema.shape.task,
    attachments: workTaskSchema.shape.attachments,
    workspaceFiles: workTaskSchema.shape.workspaceFiles,
  })
  .strict();
export type DelegationFollowUp = z.infer<typeof delegationFollowUpSchema>;
export const delegationAttemptSchema = z
  .object({
    sequence: z.number().int().positive(),
    commandId: z.string().uuid(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    status: delegationStatusSchema,
    error: z.string().optional(),
    result: delegationResultSchema.optional(),
    delivery: z.enum(["pending", "sending", "delivered", "uncertain", "suppressed"]).optional(),
    deliveryCommandId: z.string().uuid(),
    deliveryOwner: z.string().optional(),
    deliveryLeaseUntil: z.number().optional(),
  })
  .strict();
export const delegationTaskSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    parent: delegationParentSchema,
    rootParent: delegationParentSchema,
    generation: z.number().int(),
    depth: z.number().int(),
    title: delegationCreateSchema.shape.title,
    task: delegationCreateSchema.shape.task,
    background: z.string(),
    constraints: z.string(),
    expectedResult: z.string(),
    execution: workTaskExecutionSchema,
    intent: z.enum(["analysis", "edit"]),
    workspaceFiles: workTaskSchema.shape.workspaceFiles,
    attachments: workTaskSchema.shape.attachments,
    dependsOn: z.array(z.string().uuid()),
    previousTaskId: z.string().uuid().optional(),
    status: delegationStatusSchema,
    attempts: z.array(delegationAttemptSchema),
    sessionRequestId: z.string().uuid(),
    session: workTaskSchema.shape.session,
    worktree: workTaskSchema.shape.worktree,
    owner: z.string().optional(),
    leaseUntil: z.number().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type DelegationTask = z.infer<typeof delegationTaskSchema>;
export const delegationMcpRequestSchema = z
  .object({ sessionId: z.string().min(1), createRequestId: z.string().min(1).optional() })
  .strict();
