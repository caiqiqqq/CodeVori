import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createOpenComputerUseMcpServer } from "../open-mcp.mjs";

test("MCP cancellation and EOF reach the operation signal, drain work and fence reentry", async () => {
  for (const action of ["cancel", "disconnect"]) {
    const input = new PassThrough();
    const output = new PassThrough();
    let started;
    let aborted = false;
    let closed = false;
    let calls = 0;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const server = createOpenComputerUseMcpServer({
      input,
      output,
      service: {
        start: async () => {},
        close: async () => {
          closed = true;
        },
        callTool: async (_name, _args, { signal }) => {
          calls++;
          started();
          await new Promise((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
          return { content: [] };
        },
      },
    }).listen();
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_apps" },
    });
    input.write(`${call}\n`);
    await ready;
    if (action === "cancel")
      await server.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: 1 },
        }),
      );
    else input.end();
    await server.close();
    assert.equal(aborted, true);
    assert.equal(closed, true);
    await server.receive(call);
    assert.equal(calls, 1);
  }
});
