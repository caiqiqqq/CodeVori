import { z } from "zod";

/** ACP stable plan notifications contain a complete replacement list. */
export const acpPlanStepSchema = z.object({
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type AcpPlanStep = z.infer<typeof acpPlanStepSchema>;
