import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMcpConnectionPool, createMcpAdapter } from "../../adapters/src/mcp/index.js";
import { createChildTraceContext, createRootTraceContext } from "@zcode/contracts";
const config = { type: "stdio" as const, protocolVersion: "legacy" as const, isolation: "workspace" as const,
  command: process.execPath, args: [fileURLToPath(new URL("./fixtures/document-session-server.mjs", import.meta.url))] };
const trace = (id: string) => createRootTraceContext({ sessionId: id as never });

test("real document stdio process is shared per workspace while session/root viewing state stays isolated", async () => {
  const makePool = () => createMcpConnectionPool({ idleGraceMs: 0, createAdapter: ({connectionContext, workingDirectory}) => createMcpAdapter({connectionContext, workingDirectory}) });
  const pool = makePool();
  const otherWindow = makePool();
  const a = pool.acquireLease({ sessionId: "a", workingDirectory: process.cwd(), workspaceIdentity: "remote-a" });
  const b = pool.acquireLease({ sessionId: "b", workingDirectory: process.cwd(), workspaceIdentity: "remote-a" });
  const remote = pool.acquireLease({ sessionId: "c", workingDirectory: process.cwd(), workspaceIdentity: "remote-b" });
  const window = otherWindow.acquireLease({ sessionId: "a", workingDirectory: process.cwd(), workspaceIdentity: "remote-a" });
  const noScope1 = pool.acquireLease(), noScope2 = pool.acquireLease();
  const call = async (port: typeof a, id: string, path?: string) => (await port.callTool({ serverName: "documents", toolName: path ? "open" : "current", arguments: path ? { path } : {}, trace: trace(id) })).structuredContent as any;
  try {
    const statuses = await Promise.all([a, b, remote, window, noScope1, noScope2].map(port => port.connectServer("documents", config, { workingDirectory: undefined, workspaceIdentity: undefined })));
    for (const status of statuses) assert.equal(status.status, "connected", status.error);
    const first = await call(a, "a", "a.pdf"), second = await call(b, "b", "b.xlsx");
    assert.equal(first.pid, second.pid); assert.equal((await call(a, "a")).path, "a.pdf");
    const child = createChildTraceContext(trace("a"), { sessionId: "child" as never, rootSessionId: "a" as never });
    const seen = (await b.callTool({ serverName: "documents", toolName: "current", trace: child })).structuredContent as any;
    assert.equal(seen.path, "a.pdf"); assert.equal(seen.sessionId, "child");
    for (const port of [remote, window, noScope1, noScope2]) {
      const state = await call(port, "a"); assert.notEqual(state.pid, first.pid); assert.equal(state.path, null);
    }
    assert.notEqual((await call(noScope1, "x")).pid, (await call(noScope2, "x")).pid);
    await a.close(); assert.equal((await call(b, "b")).pid, first.pid);
    await b.close();
    await new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const poll = () => { try { process.kill(first.pid, 0); } catch { resolve(); return; }
        if (++attempts > 100) { reject(new Error("last lease left document process running")); return; }
        setTimeout(poll, 20);
      }; poll();
    });
  } finally { await pool.close(); await otherWindow.close(); }
});
