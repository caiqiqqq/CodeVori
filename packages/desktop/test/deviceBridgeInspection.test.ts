import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { inspectDeviceBridgeMcp } from "../src/main/deviceBridgeInspection.js";

const status = {
  sampledAt: "2026-10-25T01:02:03.000Z",
  platform: "windows",
  architecture: "amd64",
  cpuCount: 8,
  cpuModel: "Synthetic CPU",
  cpuPercent: 25,
  memory: { totalBytes: 16000, usedBytes: 8000, availableBytes: 8000 },
  processCount: 1,
  inspectedProcessCount: 1,
  processesPartial: false,
  processes: [{ pid: 42, name: "example.exe", rssBytes: 100, cpuSeconds: 4 }],
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=";
test("inspection uses fixed read tools, preserves MCP session, validates results and sanitizes failures", async () => {
  const methods: string[] = [];
  let content: unknown = [{ type: "text", text: JSON.stringify(status) }];
  let mismatch = false,
    toolError = false,
    redirect = false,
    oversize = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer private-token");
    if (req.method === "DELETE") {
      methods.push("DELETE");
      res.writeHead(204).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    methods.push(rpc.method === "tools/call" ? rpc.params.name : rpc.method);
    if (rpc.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }
    res.setHeader("Mcp-Session-Id", "private-session");
    if (rpc.method === "tools/call") {
      assert.deepEqual(rpc.params.arguments, {});
      assert.equal(req.headers["mcp-session-id"], "private-session");
      if (redirect) {
        res.writeHead(302, { Location: "https://attacker.test" }).end();
        return;
      }
      if (oversize) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(" ".repeat(2_000_001));
        return;
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: mismatch && rpc.method === "tools/call" ? 999 : rpc.id,
        result:
          rpc.method === "initialize"
            ? { protocolVersion: "2025-03-26" }
            : { isError: toolError, content },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = { url: `http://127.0.0.1:${address.port}/mcp`, token: "private-token" };
  try {
    const result = await inspectDeviceBridgeMcp(endpoint, { nodeId: "windows", kind: "system" });
    assert.deepEqual(result, { kind: "system", nodeId: "windows", status });
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "node_status", "DELETE"]);
    content = [{ type: "image", mimeType: "image/png", data: png }];
    const screen = await inspectDeviceBridgeMcp(endpoint, { nodeId: "windows", kind: "screen" });
    assert.equal(screen.kind, "screen");
    assert.ok(methods.includes("desktop_screenshot"));
    for (const bad of [
      [{ type: "image", mimeType: "image/svg+xml", data: png }],
      [{ type: "image", mimeType: "image/png", data: Buffer.from("not a PNG").toString("base64") }],
      [{ type: "text", text: JSON.stringify({ ...status, cpuPercent: 101 }) }],
      [
        {
          type: "text",
          text: JSON.stringify({ ...status, processes: Array(101).fill(status.processes[0]) }),
        },
      ],
    ]) {
      content = bad;
      await assert.rejects(
        inspectDeviceBridgeMcp(endpoint, {
          nodeId: "windows",
          kind: (bad[0] as { type: string }).type === "image" ? "screen" : "system",
        }),
        /^Error: device_bridge_inspection_unavailable$/,
      );
    }
    content = [{ type: "text", text: JSON.stringify(status) }];
    for (const change of [
      () => {
        mismatch = true;
      },
      () => {
        mismatch = false;
        toolError = true;
      },
      () => {
        toolError = false;
        redirect = true;
      },
      () => {
        redirect = false;
        oversize = true;
      },
    ]) {
      change();
      await assert.rejects(
        inspectDeviceBridgeMcp(endpoint, { nodeId: "windows", kind: "system" }),
        /^Error: device_bridge_inspection_unavailable$/,
      );
    }
    await assert.rejects(
      inspectDeviceBridgeMcp(
        { url: "https://attacker.test/mcp", token: "secret" },
        { nodeId: "windows", kind: "system" },
      ),
      /^Error: device_bridge_inspection_unavailable$/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
