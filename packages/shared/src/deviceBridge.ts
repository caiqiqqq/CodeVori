import { z } from "zod";

const nodeId = z.string().trim().min(1).max(256);
export const deviceBridgeCommandSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("configure"), binaryPath: z.string().trim().min(1).max(4096) })
    .strict(),
  z.object({ action: z.enum(["start", "stop", "logout", "open-login", "refresh"]) }).strict(),
  z.object({ action: z.enum(["connect", "disconnect", "check"]), nodeId }).strict(),
  z.object({ action: z.literal("authorize"), nodeId, allowed: z.boolean() }).strict(),
]);
export type DeviceBridgeCommand = z.infer<typeof deviceBridgeCommandSchema>;

export const deviceBridgeConfigurationSchema = z
  .object({
    binaryPath: z.string(),
    allowedNodes: z.array(nodeId).max(256),
  })
  .strict();
export type DeviceBridgeConfiguration = z.infer<typeof deviceBridgeConfigurationSchema>;

const peerSchema = z
  .object({
    nodeId,
    name: z.string(),
    os: z.string(),
    online: z.boolean(),
    connected: z.boolean(),
    allowed: z.boolean(),
  })
  .strict();
export const deviceBridgeWorkerStateSchema = z
  .object({
    backendState: z.string(),
    authUrl: z.string().optional(),
    nodeId: z.string(),
    dnsName: z.string(),
    loginName: z.string(),
    tailnet: z.string(),
    exposing: z.boolean(),
    peers: z.array(peerSchema),
  })
  .strict();
export type DeviceBridgeWorkerState = z.infer<typeof deviceBridgeWorkerStateSchema>;

export const deviceBridgeWorkerResponseSchema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    state: deviceBridgeWorkerStateSchema.optional(),
    connection: z
      .object({ nodeId, url: z.string().url(), token: z.string().min(32) })
      .strict()
      .optional(),
    error: z.string().optional(),
  })
  .strict();
export type DeviceBridgeWorkerResponse = z.infer<typeof deviceBridgeWorkerResponseSchema>;

export interface DeviceBridgePeer extends z.infer<typeof peerSchema> {
  toolCount?: number;
  checkedAt?: string;
}

/** No bearer or authentication URL crosses this UI boundary. */
export interface DeviceBridgeState {
  binaryPath: string;
  phase: "stopped" | "starting" | "running" | "error";
  backendState: string;
  canLogin: boolean;
  nodeId: string;
  dnsName: string;
  loginName: string;
  tailnet: string;
  exposing: boolean;
  peers: DeviceBridgePeer[];
  error?: string;
}
