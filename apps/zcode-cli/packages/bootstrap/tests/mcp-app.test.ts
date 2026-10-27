import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMcpAdapter } from "../../adapters/src/mcp/index.js";
import { ToolRegistryImpl } from "../../core/src/tool/registry.js";
import { registerMcpTools } from "../../core/src/mcp/index.js";
import { readMcpAppFromOutput } from "@zcode/shared";
import { mcpToolResultDisplayPayloadSchema } from "@zcode/contracts";
import { toolCallRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { createMcpToolDisplay } from "../../core/src/tool/executor/result-display.ts";
import { buildToolOutput } from "../src/zcode-protocol-v4/projection-rows.ts";

test("real MCP stdio tool -> same-server resource -> host metadata; model sees no HTML and failed resources do not repeat tools", async () => {
  const adapter = createMcpAdapter();
  try {
    const status = await adapter.connectServer("app-fixture", {
      type: "stdio",
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/mcp-app-server.mjs", import.meta.url))],
      protocolVersion: "legacy",
      timeoutMs: 10000,
    });
    assert.equal(status.status, "connected", status.error);
    const descriptors = await adapter.listTools();
    assert.equal(descriptors.length, 3);
    assert.equal(descriptors[0]?.uiResourceUri, "ui://fixture/app");
    const registry = new ToolRegistryImpl();
    const names = registerMcpTools(registry, adapter, descriptors);
    for (const [index, name] of names.entries()) {
      const entry = registry.get(name)!;
      const result = await entry.handler({}, {
        workingDirectory: "/fixture",
        traceId: "fixture-trace",
        sessionId: "fixture-session",
      } as never);
      const app = readMcpAppFromOutput(result);
      if (index === 1) {
        assert.equal(app, null);
        assert.match(JSON.stringify(result.content), /call-2/);
      } else assert.equal(app?.html, "<button>fixture-interactive-html</button>");
      const model = entry.formatModelContent!(result);
      assert.doesNotMatch(JSON.stringify(model), /fixture-interactive-html|zcode\/mcpApp|forged/);
      // Journal/snapshot JSON roundtrip preserves the host payload without another MCP request.
      assert.deepEqual(readMcpAppFromOutput(JSON.parse(JSON.stringify(result))), app);
      const display = createMcpToolDisplay(
        { serverName: "app-fixture", toolName: descriptors[index]!.toolName },
        result,
      )!;
      const persisted = mcpToolResultDisplayPayloadSchema.parse(
        JSON.parse(JSON.stringify(display)),
      );
      const projected = buildToolOutput(
        {
          success: true,
          content: typeof model === "string" ? model : JSON.stringify(model),
          display: persisted,
        },
        "call",
      );
      const row = toolCallRowSchema.parse({
        rowId: 1,
        turnId: "turn",
        createdAt: 1,
        createdAtSeq: 1,
        kind: "toolCall",
        inputText: "{}",
        toolCallId: "call",
        toolName: name,
        status: "success",
        output: projected,
      });
      assert.equal(row.output?.display?.kind, "mcp_tool");
      if (row.output?.display?.kind === "mcp_tool")
        assert.deepEqual(row.output.display.app?.resource ?? null, app);
      assert.doesNotMatch(row.output!.text, /fixture-interactive-html/);
    }
  } finally {
    await adapter.close();
  }
});
