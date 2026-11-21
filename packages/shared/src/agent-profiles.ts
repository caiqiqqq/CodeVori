import { z } from "zod";
import { workTaskExecutionSchema } from "./work-task.js";

const fields = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  instructions: z.string().trim().min(1).max(12000),
  execution: z.discriminatedUnion("kind", [
    workTaskExecutionSchema.options[0],
    workTaskExecutionSchema.options[1].omit({ modelPreference: true }),
  ]),
};
export const agentProfileSchema = z
  .object({
    ...fields,
    revision: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export const agentProfileSaveSchema = z
  .object({
    ...fields,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const agentProfileDeleteSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentProfileSave = z.infer<typeof agentProfileSaveSchema>;
export type AgentProfileDelete = z.infer<typeof agentProfileDeleteSchema>;
