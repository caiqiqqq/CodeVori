import type { DeviceBridgeReady, DeviceExecutionNodeInfo } from "./contract";

export const connectedDeviceBridge: DeviceBridgeReady = {
  event: "ready",
  version: 1,
  mode: "connect",
  nodeId: "example-client-node-id",
  dnsName: "example-client.example.ts.net",
  url: "http://127.0.0.1:18743/mcp",
};

export const executionNodeInfo: DeviceExecutionNodeInfo = {
  platform: "linux",
  architecture: "amd64",
  cpuCount: 8,
  commandSlots: 2,
  activeCommands: 0,
  desktopBackend: "linux",
  desktopTools: [],
  desktopUnavailableReason: "wayland_not_supported",
};
