import type { DeviceBridgeReady } from "./contract";

export const connectedDeviceBridge: DeviceBridgeReady = {
  event: "ready",
  version: 1,
  mode: "connect",
  nodeId: "example-client-node-id",
  dnsName: "example-client.example.ts.net",
  url: "http://127.0.0.1:18743/mcp",
};
