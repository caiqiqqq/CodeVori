export const deviceBridgeModule = {
  id: "device-bridge",
  requires: ["shared"],
  provides: [
    "tailnet-mcp-transport",
    "device-command-executor",
    "device-desktop-executor",
    "device-node-enrollment-relay",
    "external-node-installer-distribution",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
