import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigResult } from "@zcode/adapters/config";
import type { ZCodeAppOptions } from "../src/app/types.js";
import { resolveAppRuntimeConfig } from "../src/app/runtime-config.js";
import { V4CommandExecutor } from "../src/zcode-protocol-v4/commands/executor.js";
import type {
  V4CommandCoreHost,
  V4SessionRecordView,
} from "../src/zcode-protocol-v4/commands/types.js";

test("V4 create forwards its command ID before child capability provisioning", async () => {
  let creation: unknown;
  const executor = new V4CommandExecutor({
    getRecord: () => null,
    createSessionRecord: async (input) => {
      creation = input;
      return { sessionId: "child" };
    },
  });
  const result = await executor.execute({
    type: "createSession",
    sessionId: null,
    commandId: "creation-command",
    clientId: "client",
    issuedAt: 1,
    payload: { workspaceId: "/fixture" },
  });
  assert.equal((creation as { createRequestId?: string }).createRequestId, "creation-command");
  assert.equal(result?.type, "createSession");
});

test("Host delegation and issue overlay preserves user, project, plugin, and built-in MCP sources", () => {
  const server = (command: string) => ({ type: "stdio" as const, command });
  const configResult = {
    config: {
      mcp: { servers: { user: server("user"), project: server("project") } },
      permission: { mode: "default" },
      features: { mcp: true, memory: false, subagent: false },
      skills: {},
      toolConcurrency: {},
      memory: {},
      modelAnomalyGuard: {},
    },
  } as unknown as ConfigResult;
  const resolve = (options: Partial<ZCodeAppOptions>) =>
    resolveAppRuntimeConfig({
      configResult,
      options: options as ZCodeAppOptions,
      cliStorageRoot: "/fixture",
      workingDirectory: "/fixture",
      subagentOutputRootDir: "/fixture",
      pluginMcpServers: { plugin: server("plugin") },
      builtInMcpServers: { node_repl: server("builtin") },
    });
  const hostMcpServers = {
    "zcode-delegation": server("host"),
    "zcode-issues": server("issues-host"),
  };
  assert.deepEqual(Object.keys(resolve({ hostMcpServers }).configuredMcpServers).sort(), [
    "node_repl",
    "plugin",
    "project",
    "user",
    "zcode-delegation",
    "zcode-issues",
  ]);
  const explicit = resolve({
    hostMcpServers,
    runtimeConfig: {
      mcp: {
        enabled: true,
        servers: {
          custom: server("custom"),
          "zcode-delegation": server("untrusted"),
          "zcode-issues": server("untrusted-issues"),
        },
      },
    },
  });
  assert.deepEqual(Object.keys(explicit.configuredMcpServers).sort(), [
    "custom",
    "node_repl",
    "plugin",
    "zcode-delegation",
    "zcode-issues",
  ]);
  assert.equal(
    (explicit.configuredMcpServers["zcode-delegation"] as { command: string }).command,
    "host",
  );
  assert.equal(
    (explicit.configuredMcpServers["zcode-issues"] as { command: string }).command,
    "issues-host",
  );
  assert.deepEqual(Object.keys(resolve({}).configuredMcpServers).sort(), [
    "node_repl",
    "plugin",
    "project",
    "user",
  ]);
});

test("stale foreground stop cannot pause delegation; accepted stop pauses first", async () => {
  let stopped: "mismatch" | "stopped" = "mismatch";
  const order: string[] = [];
  const record = {
    app: {
      sessionId: "session",
      readTarget: async () => null,
      runtime: {
        stopActiveForegroundExecution: () => ({ kind: stopped, foregroundExecutionId: "current" }),
      },
    },
    activeAbortController: { abort: () => order.push("abort") },
    workspace: { workspacePath: "/fixture" },
  } as unknown as V4SessionRecordView;
  const host: V4CommandCoreHost = {
    getRecord: () => record,
    pauseDelegations: async () => {
      order.push("pause");
    },
  };
  const executor = new V4CommandExecutor(host);
  const envelope = {
    type: "stop" as const,
    sessionId: "session",
    commandId: "command",
    clientId: "client",
    issuedAt: 1,
    payload: { expectedForegroundExecutionId: "previous" },
  };
  await assert.rejects(executor.execute(envelope), /guard.stopTargetChanged/);
  assert.deepEqual(order, []);
  stopped = "stopped";
  await executor.execute(envelope);
  assert.deepEqual(order, ["pause", "abort"]);
});
