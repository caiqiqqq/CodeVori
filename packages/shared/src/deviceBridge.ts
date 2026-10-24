import { z } from "zod";

const nodeId = z.string().trim().min(1).max(256);
const managementNodeId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const deviceBridgeCommandSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("configure"), binaryPath: z.string().trim().min(1).max(4096) })
    .strict(),
  z.object({ action: z.enum(["start", "stop", "logout", "open-login", "refresh"]) }).strict(),
  z.object({ action: z.enum(["connect", "disconnect", "check"]), nodeId }).strict(),
  z.object({ action: z.literal("authorize"), nodeId, allowed: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("configure-management"),
      apiKey: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .strict(),
  z.object({ action: z.literal("clear-management") }).strict(),
  z.object({ action: z.literal("remove"), nodeId: managementNodeId }).strict(),
]);
export type DeviceBridgeCommand = z.infer<typeof deviceBridgeCommandSchema>;

export const deviceBridgeConfigurationSchema = z
  .object({
    binaryPath: z.string(),
    allowedNodes: z.array(nodeId).max(256),
  })
  .strict();
export type DeviceBridgeConfiguration = z.infer<typeof deviceBridgeConfigurationSchema>;

const deviceBridgeErrorCodes = [
  "device_bridge_component_missing",
  "device_bridge_component_not_executable",
  "device_bridge_start_failed",
  "device_bridge_process_closed",
  "device_bridge_operation_failed",
  "device_bridge_management_required",
  "device_bridge_management_unauthorized",
  "device_bridge_management_forbidden",
  "device_bridge_management_failed",
  "device_bridge_device_missing",
  "device_bridge_device_external",
  "device_bridge_invalid_device",
  "device_bridge_removal_unconfirmed",
  "device_bridge_removal_cleanup_failed",
] as const;
export type DeviceBridgeErrorCode = (typeof deviceBridgeErrorCodes)[number];

/** Only allowlisted codes cross into user-facing diagnostics, including Electron's IPC prefix. */
export function getDeviceBridgeErrorCode(error: unknown): DeviceBridgeErrorCode {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    deviceBridgeErrorCodes.find((code) => message === code || message.endsWith(`: ${code}`)) ??
    "device_bridge_operation_failed"
  );
}

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
  managementConfigured: boolean;
  peers: DeviceBridgePeer[];
  error?: DeviceBridgeErrorCode;
}
