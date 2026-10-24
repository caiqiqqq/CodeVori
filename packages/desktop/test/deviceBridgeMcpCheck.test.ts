import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { checkDeviceBridgeMcp } from "../src/main/deviceBridgeMcpCheck.js";

test("MCP health requires initialize and tools/list, preserves session, and closes its test session", async () => {
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    if (req.method === "DELETE") {
      methods.push("DELETE");
      res.writeHead(204).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    methods.push(message.method);
    if (message.method !== "initialize")
      assert.equal(req.headers["mcp-session-id"], "synthetic-session");
    if (message.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }
    res.setHeader("Mcp-Session-Id", "synthetic-session");
    res.setHeader(
      "Content-Type",
      message.method === "initialize" ? "application/json" : "text/event-stream",
    );
    if (message.method === "initialize")
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-03-26" },
        }),
      );
    else {
      // 网络分片可能正好拆开 CRLF，解析不能依赖每个 chunk 都包含完整换行。
      res.write(
        'event: message\r\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"Snapshot"}]}}\r',
      );
      setTimeout(() => res.write("\n\r\n"), 10);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(
      await checkDeviceBridgeMcp({
        url: `http://127.0.0.1:${address.port}/mcp`,
        token: "synthetic-token",
      }),
      1,
    );
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "DELETE"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("health check refuses arbitrary upstream URLs and reports no credentials", async () => {
  for (const url of [
    "https://example.test/mcp",
    "http://127.0.0.1:8000/other",
    "http://secret:password@127.0.0.1:8000/mcp",
  ])
    await assert.rejects(
      checkDeviceBridgeMcp({ url, token: "synthetic-secret" }),
      /device_bridge_invalid_endpoint/,
    );
});

test("relay check is restricted to the configured origin, base path and pair route", async () => {
  for (const url of [
    "https://other.test/device-node/v1/pairs/" + "a".repeat(43) + "/mcp",
    "https://example.test/other/v1/pairs/" + "a".repeat(43) + "/mcp",
    "https://example.test/device-node/v1/pairs/invalid/mcp",
    "https://user:secret@example.test/device-node/v1/pairs/" + "a".repeat(43) + "/mcp",
  ])
    await assert.rejects(
      checkDeviceBridgeMcp({ url, token: "private" }, "https://example.test/device-node"),
      /device_bridge_invalid_endpoint/,
    );
});
