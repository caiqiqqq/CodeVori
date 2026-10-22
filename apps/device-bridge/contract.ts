/** Versioned stdout record emitted after the bridge has bound its listener. */
export interface DeviceBridgeReady {
  event: "ready";
  version: 1;
  mode: "serve" | "connect";
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

/** Desktop manage mode uses the validated public wire schemas from @zcode/shared. */
export type { DeviceBridgeWorkerResponse, DeviceBridgeWorkerState } from "@zcode/shared";
