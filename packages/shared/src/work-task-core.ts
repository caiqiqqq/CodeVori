import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";
import { acpAgentSchema } from "./zcode-protocol/acp.js";

export const workTaskScopeSchema = z.object({
  workspacePath: z.string().trim().min(1),
  workspaceIdentity: z.string().trim().min(1).optional(),
  remoteSessionId: z.string().trim().min(1).optional(),
});
export type WorkTaskScope = z.infer<typeof workTaskScopeSchema>;

export const workTaskTargetSchema = workTaskScopeSchema.extend({ id: z.string().min(1) }).strict();
export type WorkTaskTarget = z.infer<typeof workTaskTargetSchema>;
export const workTaskExecutionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("api"),
      modelSelection: modelSelectionSchema,
      mode: z.enum(["build", "edit", "plan", "yolo", "guarded"]),
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
      /** Resolved ACP Host preference; MCP callers cannot select this field. */
      modelPreference: z
        .object({
          configId: z.string().trim().min(1).max(256),
          value: z.string().min(1).max(512),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type WorkTaskExecution = z.infer<typeof workTaskExecutionSchema>;

export const workTaskWorktreeSchema = z
  .object({
    rootPath: z.string().min(1),
    path: z.string().min(1),
    projectPath: z.string().min(1),
    branchName: z.string().min(1),
    baseCommit: z.string().min(1),
    /** Explicitly accepted current branch; absent on legacy tasks means branchName. */
    acceptedBranchName: z.string().min(1).optional(),
  })
  .strict();
