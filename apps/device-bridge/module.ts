export const deviceBridgeModule = {
  id: "device-bridge",
  requires: ["shared"],
  provides: [
    "tailnet-mcp-transport",
    "device-command-executor",
    "device-system-observation",
    "device-desktop-executor",
    "device-node-tailnet-identity",
    "external-node-installer-distribution",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
