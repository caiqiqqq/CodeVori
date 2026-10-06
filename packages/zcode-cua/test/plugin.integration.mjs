import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import readline from "node:readline";

const root = resolve(import.meta.dirname, "../../..");
const plugin = resolve(root, "packages/zcode-cua-plugin");
for (const asset of [
  "dist/mcp/server.js",
  "dist/native/OpenZCodeNative",
  "dist/LICENSE",
  "dist/NOTICE",
])
  await access(resolve(plugin, asset));
const child = spawn(
  process.execPath,
  [
    resolve(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    "__zcode-plugin-host",
    resolve(plugin, "dist/mcp/server.js"),
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPEN_ZCODE_CUA_NATIVE: "/untrusted/override",
      ZCODE_OPEN_CUA_NATIVE: "/untrusted/override",
      OPEN_ZCODE_CUA_ALLOW_GLOBAL_POINTER: "1",
    },
  },
);
const exited = once(child, "exit");
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
lines.on("line", (line) => {
  const response = JSON.parse(line);
  pending.get(response.id)?.resolve(response);
  pending.delete(response.id);
});
child.once("exit", (code, signal) => {
  for (const waiter of pending.values())
    waiter.reject(new Error(`Plugin host exited (${signal ?? code}): ${stderr}`));
  pending.clear();
});
async function request(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const result = await response;
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.result;
}
const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
try {
  assert.equal((await request("initialize")).serverInfo.name, "open-zcode-computer-use");
  assert.equal((await request("tools/list")).tools.length, 30);
  assert.equal(
    (
      await request("tools/call", {
        name: "list_apps",
        _meta: { "com.zcode/request-context": { runtime_scope: "subagent" } },
      })
    ).isError,
    true,
  );
  const displays = await request("tools/call", { name: "list_displays", arguments: {} });
  assert.notEqual(displays.isError, true, JSON.stringify(displays));
  const stopped = await request("tools/call", { name: "stop_computer_control", arguments: {} });
  assert.notEqual(stopped.isError, true, JSON.stringify(stopped));
  assert.equal(JSON.parse(stopped.content.find((item) => item.type === "text").text).stopped, true);
  assert.equal(
    (await request("tools/call", { name: "list_displays", arguments: {} })).isError,
    true,
  );
  child.stdin.end();
  assert.deepEqual(await exited, [0, null]);
  console.log(
    "PASS: real plugin-host MCP handshake, 30 tools, subagent rejection, native display read, stop latch and clean EOF; executable overrides ignored.",
  );
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await exited;
  }
  lines.close();
}
