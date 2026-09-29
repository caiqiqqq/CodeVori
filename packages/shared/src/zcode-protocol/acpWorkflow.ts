import { z } from "zod";
import { toolCallCreateWorkflowDisplaySchema } from "../zcode-protocol-v4/create-workflow-display.js";

/** 只能由目标 Host 的真实执行器写入；不能按 ACP 工具名称推断这个标记。 */
export const acpWorkflowToolSchema = z
  .object({
    runId: z.string().regex(/^acp-workflow-[0-9a-f-]{36}$/i),
    name: z.string().min(1).max(128),
    graph: toolCallCreateWorkflowDisplaySchema.shape.causalityGraph.optional(),
  })
  .strict();
export type AcpWorkflowTool = z.infer<typeof acpWorkflowToolSchema>;

export const acpWorkflowControlSchema = z
  .object({
    id: z.string().uuid(),
    workspacePath: z.string().min(1),
    workspaceIdentity: z.string().optional(),
    remoteSessionId: z.string().optional(),
    runId: acpWorkflowToolSchema.shape.runId,
  })
  .strict();
export type AcpWorkflowControl = z.infer<typeof acpWorkflowControlSchema>;

export const acpWorkflowArtifactQuerySchema = acpWorkflowControlSchema
  .extend({
    artifactId: z.string().min(1).max(128),
  })
  .strict();
export type AcpWorkflowArtifactQuery = z.infer<typeof acpWorkflowArtifactQuerySchema>;
