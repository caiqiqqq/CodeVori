import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../cli/dist/zcode.cjs", import.meta.url));
const REQUEST_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

test(
  "built CLI with expired temp env serves API capabilities and ACP plugins without model prompts",
  {
    skip: process.platform === "win32",
    timeout: 30_000,
  },
  async () => {
    await stat(cli);
    const root = await mkdtemp(join(tmpdir(), "znr-cli-"));
    const missing = join(root, "expired-temp");
    const child = spawn(process.execPath, [cli, "app-server", "--stdio", "--surface", "desktop"], {
      cwd: root,
      env: {
        ...process.env,
        TMPDIR: missing,
        TMP: missing,
        TEMP: missing,
        ZCODE_STORAGE_DIR: join(root, "storage"),
        ZCODE_DATA_BASE_DIR: root,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map();
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const closed = new Promise((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    child.once("error", (error) => {
      for (const request of pending.values()) request.reject(error);
    });
    child.once("exit", () => {
      for (const request of pending.values())
        request.reject(new Error("CLI exited before the read-only response"));
    });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error)
        request.reject(new Error(`CLI read-only request failed: ${message.error.code}`));
      else request.resolve(message.result);
    });
    const request = async (method, params = {}) => {
      const id = randomUUID();
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          timer = setTimeout(
            () => reject(new Error(`CLI ${method} timed out`)),
            REQUEST_TIMEOUT_MS,
          );
          child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        });
      } finally {
        clearTimeout(timer);
        pending.delete(id);
      }
    };
    try {
      const capabilities = await request("runtime/capabilities");
      assert.equal(typeof capabilities, "object");
      assert.ok(capabilities);
      const plugins = await request("plugins/acpCapabilities", {
        workspace: { workspacePath: root, workspaceKey: root },
      });
      assert.ok(Array.isArray(plugins.plugins));
      assert.ok(Array.isArray(plugins.servers));
      assert.equal(child.exitCode, null);
      await assert.rejects(stat(missing), { code: "ENOENT" });
      assert.doesNotMatch(
        stderr,
        /stdout_closed|listen EACCES|No usable Node REPL browser broker socket directory/,
      );
      child.stdin.end();
      const exit = await closed;
      assert.equal(exit.code, 0);
    } finally {
      const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_TIMEOUT_MS);
      if (child.exitCode === null) child.kill("SIGTERM");
      await closed;
      clearTimeout(timer);
      lines.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
