import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { OpenZCodeMCPServer } from "../src/mcp-server.mjs";

function nextLine(stream) {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index === -1) return;
      stream.off("data", onData);
      resolve(JSON.parse(buffer.slice(0, index)));
    };
    stream.on("data", onData);
  });
}

test("MCP initialize and tools/list do not require the native executor", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const service = {
    start: async () => {
      throw new Error("must not start");
    },
    close: async () => {},
  };
  const server = new OpenZCodeMCPServer({ input, output, service }).listen();

  let response = nextLine(output);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  })}\n`);
  assert.equal((await response).result.serverInfo.name, "open-zcode-computer-use");

  response = nextLine(output);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  })}\n`);
  assert.equal((await response).result.tools.length, 30);
  input.end();
  await server.close();
});

test("subagent calls are rejected before starting native control", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const service = {
    start: async () => {
      throw new Error("must not start");
    },
    close: async () => {},
  };
  const server = new OpenZCodeMCPServer({ input, output, service }).listen();
  const response = nextLine(output);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "list_apps",
      arguments: {},
      _meta: {
        "com.zcode/request-context": { runtime_scope: "subagent" },
      },
    },
  })}\n`);
  const message = await response;
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /SUBAGENT_COMPUTER_USE_UNAVAILABLE/u);
  input.end();
  await server.close();
});

test("invalid nested tool arguments are rejected before native startup", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const service = {
    start: async () => {
      throw new Error("must not start");
    },
    close: async () => {},
  };
  const server = new OpenZCodeMCPServer({ input, output, service }).listen();
  const response = nextLine(output);
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "left_click",
      arguments: {
        target: { type: "coordinate", x: -1, y: 0, extra: true },
      },
    },
  })}\n`);
  const message = await response;
  assert.equal(message.error.code, -32602);
  assert.match(message.error.message, /Invalid arguments/u);
  input.end();
  await server.close();
});
