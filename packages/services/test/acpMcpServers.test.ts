import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { NativeMcpServerRecord } from "@zcode/shared";
import { projectAcpMcpServers } from "../src/acp/acpMcpServers.js";

const record = (
  name: string,
  config: NativeMcpServerRecord["config"],
  scope: "user" | "workspace" = "user",
  enabled = true,
): NativeMcpServerRecord => ({
  source: "zcodeagentmcp",
  name,
  config,
  scope,
  enabled,
});

test("ACP MCP projects enabled effective settings and resolves stdio commands on the target Host", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-mcp-"));
  try {
    const executable = join(root, "worker");
    await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 });
    const projected = await projectAcpMcpServers(
      [
        record("tool", { command: "missing", args: [] }, "user"),
        record(
          "tool",
          { command: "worker", args: ["--local"], env: { TOKEN: "private" } },
          "workspace",
        ),
        record("disabled", { command: "missing" }, "workspace", false),
        record("remote", {
          type: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "secret" },
        }),
      ],
      { http: true },
      root,
      { PATH: root },
    );
    assert.deepEqual(projected, [
      {
        name: "tool",
        command: executable,
        args: ["--local"],
        env: [{ name: "TOKEN", value: "private" }],
      },
      {
        name: "remote",
        type: "http",
        url: "https://example.test/mcp",
        headers: [{ name: "Authorization", value: "secret" }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP MCP refuses unsupported transport, special authentication, and direct CUA execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-mcp-invalid-"));
  try {
    const project = (config: NativeMcpServerRecord["config"], capabilities = {}) =>
      projectAcpMcpServers([record("example", config)], capabilities, root, { PATH: root });
    await assert.rejects(
      project({ type: "http", url: "https://example.test/mcp" }),
      /example.*HTTP/i,
    );
    await assert.rejects(project({ command: "absent" }), /example.*可执行/i);
    await assert.rejects(
      project(
        { type: "http", url: "https://example.test/mcp", oauth: { type: "authorization_code" } },
        { http: true },
      ),
      /example.*OAuth/i,
    );
    await assert.rejects(project({ command: "zcode-cua" }), /example.*CUA/i);
    await assert.rejects(
      project(
        {
          type: "http",
          url: "https://example.test/mcp",
          auth: { type: "zcode_official", provider: "jwt_token" },
        },
        { http: true },
      ),
      /example.*认证/i,
    );
    await assert.rejects(project({ command: "worker", timeoutMs: 60_000 }), /example.*超时/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
