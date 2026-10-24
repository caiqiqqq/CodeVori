import { z } from "zod";

export const deviceNodePlatformSchema = z.enum([
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
]);
export type DeviceNodePlatform = z.infer<typeof deviceNodePlatformSchema>;
export const deviceNodeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const deviceNodeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("node-create"), platform: deviceNodePlatformSchema }).strict(),
  z.object({ action: z.literal("node-remove"), id: deviceNodeIdSchema }).strict(),
  z
    .object({ action: z.literal("node-enable"), id: deviceNodeIdSchema, enabled: z.boolean() })
    .strict(),
]);
export type DeviceNodeCommand = z.infer<typeof deviceNodeCommandSchema>;
export interface DeviceNodeView {
  id: string;
  platform: DeviceNodePlatform;
  status: "waiting" | "offline" | "checking" | "ready" | "expired" | "disabled" | "error";
  enabled: boolean;
  installationUrl?: string;
  expiresAt: string;
  toolCount?: number;
}
