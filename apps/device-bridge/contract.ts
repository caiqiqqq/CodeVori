/** Versioned stdout record emitted after the bridge has bound its listener. */
export interface DeviceBridgeReady {
  event: "ready";
  version: 1;
  mode: "serve" | "connect" | "node";
  nodeId: string;
  dnsName: string;
  /** connect: loopback MCP URL; serve: tailnet MCP URL. */
  url: string;
}

/** Enrollment result; no HTTP listener is opened in identity mode. */
export interface DeviceBridgeIdentity {
  event: "identity";
  version: 1;
  nodeId: string;
  dnsName: string;
}

export type DeviceBridgeEvent = DeviceBridgeReady | DeviceBridgeIdentity;

/** node_info is an MCP tool result, never an Agent/task snapshot or a reservation. */
export interface DeviceExecutionNodeInfo {
  platform: "windows" | "darwin" | "linux";
  architecture: string;
  cpuCount: number;
  commandSlots: number;
  activeCommands: number;
  desktopBackend: string;
  desktopTools: string[];
  desktopUnavailableReason: string;
}

/** Desktop manage mode uses the validated public wire schemas from @zcode/shared. */
export type { DeviceBridgeWorkerResponse, DeviceBridgeWorkerState } from "@zcode/shared";

/** Static installer download request. Execution uses the existing tailnet member contract. */
export type { DeviceNodeCommand, DeviceNodePlatform } from "@zcode/shared";

/** Read-only device inspection over the existing authenticated member MCP endpoint. */
export type {
  DeviceSystemStatus,
  DeviceInspectionRequest,
  DeviceInspectionResult,
} from "@zcode/shared";
