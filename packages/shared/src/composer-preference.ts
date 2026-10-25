import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";
import { acpAgentSchema, acpWorkspaceSchema } from "./zcode-protocol/acp.js";

export const composerPreferenceScopeSchema = acpWorkspaceSchema;
export const composerPreferenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api"), selection: modelSelectionSchema }).strict(),
  z.object({ kind: z.literal("acp"), agent: acpAgentSchema }).strict(),
]);
export const composerAcpModelPreferenceSchema = z
  .object({ configId: z.string().trim().min(1).max(256), value: z.string().min(1).max(512) })
  .strict();
export const composerPreferenceSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    target: composerPreferenceTargetSchema.optional(),
    acpModels: z.partialRecord(acpAgentSchema, composerAcpModelPreferenceSchema).default({}),
  })
  .strict();
export const composerPreferenceUpdateSchema = composerPreferenceScopeSchema
  .extend({
    commandId: z.string().uuid(),
    target: composerPreferenceTargetSchema.optional(),
    acpModel: composerAcpModelPreferenceSchema.extend({ agent: acpAgentSchema }).optional(),
  })
  .strict()
  .refine((input) => input.target || input.acpModel, "A preference change is required");

export type ComposerPreferenceScope = z.infer<typeof composerPreferenceScopeSchema>;
export type ComposerPreferenceTarget = z.infer<typeof composerPreferenceTargetSchema>;
export type ComposerPreference = z.infer<typeof composerPreferenceSchema>;
export type ComposerPreferenceUpdate = z.infer<typeof composerPreferenceUpdateSchema>;
