import { z } from "zod";

/** Live processes belong to the ACP connection; snapshots contain display facts only. */
export const acpTerminalSchema = z.object({
  terminalId: z.string().min(1).max(256),
  title: z.string().max(8192),
  status: z.enum(["running", "finished", "released", "interrupted"]),
  startedAt: z.number().finite().nonnegative(),
  output: z.string().max(64 * 1024),
  truncated: z.boolean(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
});
export type AcpTerminal = z.infer<typeof acpTerminalSchema>;
