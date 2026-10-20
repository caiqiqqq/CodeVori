import assert from "node:assert/strict";
import test from "node:test";
import type { McpPort, McpToolDescriptor } from "@zcode/contracts";
import { ZCODE_CUA_OFFICIAL_MCP_NAMESPACE_NAME } from "@zcode/shared";
import { registerMcpTools } from "../src/mcp/index.js";
import { ToolRegistryImpl } from "../src/tool/registry.js";

test("open computer tools require system approval without proprietary authority or aliases", () => {
  const registry = new ToolRegistryImpl();
  const descriptor: McpToolDescriptor = {
    serverName: ZCODE_CUA_OFFICIAL_MCP_NAMESPACE_NAME,
    toolName: "list_apps",
    inputSchema: { type: "object", properties: {} },
  };
  const names = registerMcpTools(registry, {} as McpPort, [descriptor]);
  const entry = registry.get(names[0]!)!;
  assert.equal(entry.permission.sideEffectScope, "system");
  assert.equal(entry.permission.needsApproval, true);
  assert.equal(entry.permissionCapabilityGroup, undefined);
  assert.equal(entry.modelContentProtection, undefined);
  assert.equal(entry.aliases?.length ?? 0, 0);
  assert.equal(names[0]!.startsWith("mcp__computer-use__"), false);
});
