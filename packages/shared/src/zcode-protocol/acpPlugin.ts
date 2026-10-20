import { z } from "zod";

/** Display-only Host projection; resolved plugin MCP config never crosses to Renderer. */
export const acpPluginSchema = z.object({
  pluginId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mcpServerNames: z.array(z.string()),
  skillNames: z.array(z.string()),
});
export type AcpPlugin = z.infer<typeof acpPluginSchema>;
