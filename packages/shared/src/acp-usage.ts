import { z } from "zod";

/** Token facts from a known adapter; input includes cache tokens after normalization. */
export const acpTokenUsageSchema = z.object({
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type AcpTokenUsage = z.infer<typeof acpTokenUsageSchema>;
export const acpModelTokenUsageSchema = acpTokenUsageSchema.extend({
  modelId: z.string().trim().min(1).max(256),
});
export type AcpModelTokenUsage = z.infer<typeof acpModelTokenUsageSchema>;
export const acpUsageReportSchema = z.object({
  scope: z.enum(["turn", "session"]),
  usage: acpTokenUsageSchema,
  models: z.array(acpModelTokenUsageSchema).max(256).default([]),
});
export type AcpUsageReport = z.infer<typeof acpUsageReportSchema>;
export const acpUsageTurnSchema = acpTokenUsageSchema.extend({
  commandId: z.string().min(1),
  models: z.array(acpModelTokenUsageSchema).max(256).default([]),
});
export type AcpUsageTurn = z.infer<typeof acpUsageTurnSchema>;
