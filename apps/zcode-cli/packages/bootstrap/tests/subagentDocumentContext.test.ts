import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMcpAdapter } from "../../adapters/src/mcp/index.js";
import { createChildTraceContext, createRootTraceContext } from "@zcode/contracts";
import { createExploreSubagentPort } from "../../core/src/subagent/runner.js";
import { registerMcpTools } from "../../core/src/mcp/index.js";
import { ToolRegistryImpl } from "../../core/src/tool/registry.js";

test("a real child MCP call sees its root conversation document without replacing the child trace or leaking to other roots", async () => {
  const adapter = createMcpAdapter();
  const outputRootDir = await mkdtemp(join(tmpdir(), "zcode-document-child-"));
  try {
    const connected = await adapter.connectServer("documents", { type: "stdio", protocolVersion: "legacy", command: process.execPath, args: [fileURLToPath(new URL("./fixtures/document-session-server.mjs", import.meta.url))] });
    assert.equal(connected.status, "connected", connected.error);
    const registry = new ToolRegistryImpl();
    const names = registerMcpTools(registry, adapter, await adapter.listTools());
    const call = (tool: string, trace: ReturnType<typeof createRootTraceContext>, input = {}) => registry.get(names.find((name) => name.endsWith(`__${tool}`))!)!.handler(input, { traceContext: trace, traceId: trace.traceId, sessionId: trace.sessionId, workingDirectory: "/fixture", runtimeScope: trace.sessionId === "root-a" ? "main" : "subagent" } as never);
    const parent = createRootTraceContext({ sessionId: "root-a" as never });
    await call("open", parent, { path: "/fixture/report.pdf" });
    let seen: any;
    let childTrace: any;
    const child = createExploreSubagentPort({ outputRootDir, emitParentEvent: async () => {}, runExploreAgent: async (request) => {
      await request.onSessionReady?.();
      childTrace = request.traceContext;
      seen = await call("current", childTrace);
      return { response: "done", traceId: childTrace.traceId, events: [] };
    } });
    await child.run({ sessionId: "root-a" as never, parentToolCallId: "call", agentType: "general-purpose", description: "read opened document", prompt: "read current document", trace: parent, workingDirectory: "/fixture", workspaceRoot: "/fixture" });
    assert.equal(seen.structuredContent.path, "/fixture/report.pdf");
    assert.notEqual(seen.structuredContent.sessionId, "root-a");
    assert.equal(seen.structuredContent.rootSessionId, "root-a");
    const nested = createChildTraceContext(childTrace, { sessionId: "nested-child" as never });
    assert.equal((await call("current", nested)).structuredContent?.path, "/fixture/report.pdf");
    assert.equal((await call("current", createRootTraceContext({ sessionId: "root-b" as never }))).structuredContent?.path, null);
  } finally { await adapter.close(); await rm(outputRootDir, { recursive: true, force: true }); }
});
