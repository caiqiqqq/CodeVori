import { z } from "zod";
import { acpPlanStepSchema } from "../acp-plan.js";

/** Presentation of a reported plan; not a tool execution or a command. */
export const planRowFields = {
  kind: z.literal("plan"),
  planId: z.string(),
  entries: z.array(acpPlanStepSchema),
};
