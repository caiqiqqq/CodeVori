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
export const deviceNodeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("download-node"), platform: deviceNodePlatformSchema }).strict(),
]);
export type DeviceNodeCommand = z.infer<typeof deviceNodeCommandSchema>;
