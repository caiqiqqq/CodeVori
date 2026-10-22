export const deviceBridgeModule = {
  id: "device-bridge",
  requires: ["shared"],
  provides: ["tailnet-mcp-transport"],
  publicEntrypoints: ["contract.ts"],
} as const;
