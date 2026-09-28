import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { AcpSessionLoadError, connectAcpAgent } from "../src/acp/acpStdioConnection.js";
import type { AcpUpdate } from "../src/acp/acpServiceImpl.js";

const fakeAgent = `#!/usr/bin/env node
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: process.env.ACP_FAKE_NO_LOAD !== '1', promptCapabilities: { image: true, embeddedContext: true } } } });
  } else if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId: 'fake-native-session' } });
  } else if (message.method === 'session/load') {
    if (message.params.sessionId === 'missing-native') {
      send({ id: message.id, error: { code: -32603, message: 'Internal error' } });
      return;
    }
    send({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old history' } } } });
    send({ id: message.id, result: {} });
  } else if (message.method === 'session/prompt') {
    if (message.params.prompt?.[1]?.type !== 'image') throw new Error('image block was not delivered');
    global.promptId = message.id;
    send({ method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Inspect', status: 'pending' } } });
    send({ id: 'permission-1', method: 'session/request_permission', params: { sessionId: message.params.sessionId, toolCall: { toolCallId: 'tool-1', title: 'Inspect' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }] } });
  } else if (message.id === 'permission-1') {
    if (message.result?.outcome?.optionId !== 'allow') throw new Error('permission was not selected');
    send({ method: 'session/update', params: { sessionId: 'fake-native-session', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed' } } });
    send({ method: 'session/update', params: { sessionId: 'fake-native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello from fake ACP' }, messageId: 'answer-1' } } });
    send({ id: global.promptId, result: { stopReason: 'end_turn' } });
  }
});
`;

const fakeUsageAgent = `#!/usr/bin/env node
const readline = require('node:readline');
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {
    protocolVersion: 1,
    agentInfo: { name: process.env.FAKE_AGENT_NAME },
  } });
  else if (message.method === 'session/new') send({ id: message.id, result: { sessionId: 'usage-native' } });
  else if (message.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 'usage-native', update: {
      sessionUpdate: 'usage_update', used: 9000, size: 200000,
    } } });
    send({ id: message.id, result: {
      stopReason: 'end_turn',
      usage: { totalTokens: 20, inputTokens: 5, outputTokens: 3, cachedReadTokens: 10, cachedWriteTokens: 2 },
      _meta: { quota: { model_usage: [{ model: 'claude-sonnet', token_count: {
        totalTokens: 20, inputTokens: 5, outputTokens: 3, cachedInputTokens: 10, cachedWriteTokens: 2,
      } }] } },
    } });
  }
});
`;

const fakeMcpAgent = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } } });
  else if (message.method === 'session/new' || message.method === 'session/load') {
    fs.appendFileSync(process.env.ACP_MCP_CAPTURE, JSON.stringify({ method: message.method, params: message.params }) + '\\n');
    send({ id: message.id, result: message.method === 'session/new' ? { sessionId: 'mcp-session' } : {} });
  }
});
`;

test("stdio ACP sends target MCP settings in both session/new and session/load", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-mcp-wire-"));
  const agentFile = join(directory, "fake-mcp.cjs");
  const worker = join(directory, "worker");
  const capture = join(directory, "capture.jsonl");
  try {
    await writeFile(agentFile, fakeMcpAgent);
    await writeFile(worker, "#!/bin/sh\n", { mode: 0o755 });
    const connect = (sessionId?: string) => connectAcpAgent({
      agent: "codex",
      workspacePath: directory,
      sessionId,
      launch: { command: process.execPath, args: [agentFile], env: { ...process.env, PATH: directory, ACP_MCP_CAPTURE: capture } },
      mcpServers: [
        { source: "zcodeagentmcp", scope: "user", name: "worker", config: { command: "worker", env: { KEY: "value" } }, enabled: true },
        { source: "zcodeagentmcp", scope: "workspace", name: "http", config: { type: "http", url: "https://example.test/mcp" }, enabled: true },
      ],
      onUpdate: async () => {},
      onPermission: async () => null,
      onExit: () => {},
    });
    const first = await connect();
    first.close();
    await first.closed;
    const loaded = await connect("mcp-session");
    loaded.close();
    await loaded.closed;
    const requests = (await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(requests.map((request) => request.method), ["session/new", "session/load"]);
    for (const request of requests) {
      assert.deepEqual(request.params.mcpServers, [
        { name: "worker", command: worker, args: [], env: [{ name: "KEY", value: "value" }] },
        { name: "http", type: "http", url: "https://example.test/mcp", headers: [] },
      ]);
      assert.equal(request.params.cwd, directory);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stdio usage projection uses verified Agent identity, prompt report and ignores context occupancy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-usage-stdio-"));
  const executable = join(directory, "fake-usage.cjs");
  try {
    await writeFile(executable, fakeUsageAgent, { mode: 0o755 });
    for (const [agent, agentName] of [
      ["claude", "@agentclientprotocol/claude-agent-acp"],
      ["codex", "@agentclientprotocol/codex-acp"],
    ] as const) {
      const updates: AcpUpdate[] = [];
      const connection = await connectAcpAgent({
        agent,
        workspacePath: directory,
        launch: { command: process.execPath, args: [executable], env: { ...process.env, FAKE_AGENT_NAME: agentName } },
        onUpdate: async (update) => { updates.push(update); },
        onPermission: async () => null,
        onExit: () => {},
      });
      try {
        const report = await connection.prompt("hello");
        assert.deepEqual(updates, [], "context occupancy must not be counted as spend");
        if (agent === "claude") assert.deepEqual(report, {
          scope: "turn",
          usage: { totalTokens: 20, inputTokens: 17, outputTokens: 3 },
          models: [{ modelId: "claude-sonnet", totalTokens: 20, inputTokens: 17, outputTokens: 3 }],
        });
        else assert.equal(report, null);
      } finally {
        connection.close();
        await connection.closed;
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stdio ACP creates, resumes, streams tool/text and waits for an explicit permission choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-stdio-"));
  const executable = join(directory, "codex-acp");
  const originalPath = process.env.PATH;
  const updates: AcpUpdate[] = [];
  const permissions: string[] = [];
  try {
    await writeFile(executable, fakeAgent, { mode: 0o755 });
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
    const connect = (sessionId?: string) =>
      connectAcpAgent({
        agent: "codex",
        workspacePath: directory,
        sessionId,
        onUpdate: async (update) => {
          updates.push(update);
        },
        onPermission: async (request) => {
          permissions.push(request.title);
          return "allow";
        },
        onExit: () => {},
      });
    const first = await connect();
    assert.equal(first.sessionId, "fake-native-session");
    assert.deepEqual(first.promptCapabilities, { image: true, embeddedContext: true });
    await first.prompt("test", [
      { type: "text", text: "test" },
      { type: "image", mimeType: "image/png", data: "cG5n" },
    ]);
    assert.deepEqual(permissions, ["Inspect"]);
    assert.deepEqual(updates, [
      { kind: "tool", id: "tool-1", title: "Inspect", status: "pending" },
      { kind: "tool", id: "tool-1", status: "completed" },
      { kind: "text", text: "hello from fake ACP", messageId: "answer-1" },
    ]);
    first.close();
    await first.closed;
    const resumed = await connect(first.sessionId);
    assert.equal(updates.length, 3, "loaded history should not be duplicated");
    resumed.close();
    await resumed.closed;
    await assert.rejects(connect("missing-native"), (error: unknown) => {
      assert.ok(error instanceof AcpSessionLoadError);
      assert.match(error.message, /Internal error/);
      return true;
    });
    await assert.rejects(
      connectAcpAgent({
        agent: "codex",
        workspacePath: directory,
        sessionId: "old-native",
        launch: { command: executable, args: [], env: { ...process.env, ACP_FAKE_NO_LOAD: "1" } },
        onUpdate: async () => {},
        onPermission: async () => null,
        onExit: () => {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof AcpSessionLoadError);
        assert.match(error.message, /不支持恢复会话/);
        return true;
      },
    );
  } finally {
    process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});

const fakeConfigAgent = `#!/usr/bin/env node
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const first = [
  { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'one', options: [
    { group: 'family', name: 'Family', options: [{ value: 'one', name: 'One', description: 'First model' }, { value: 'two', name: 'Two' }] }
  ], _meta: { secret: 'must-not-persist' } },
  { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false }
];
const later = [
  { id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'two', options: [{ value: 'two', name: 'Two' }] },
  { id: 'fast', name: 'Fast', type: 'boolean', currentValue: true }
];
const modes = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (!message.params.clientCapabilities?.session?.configOptions?.boolean) throw new Error('boolean capability missing');
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  } else if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId: 'config-session', configOptions: first, modes } });
  } else if (message.method === 'session/load') {
    send({ id: message.id, result: { configOptions: later, modes: { ...modes, currentModeId: 'plan' } } });
  } else if (message.method === 'session/set_config_option') {
    if (message.params.configId === 'fast' && (message.params.type !== 'boolean' || message.params.value !== true)) throw new Error('bad boolean request');
    if (message.params.configId === 'model' && message.params.value !== 'two') throw new Error('bad model request');
    send({ method: 'session/update', params: { sessionId: 'config-session', update: { sessionUpdate: 'config_option_update', configOptions: later } } });
    send({ id: message.id, result: { configOptions: later } });
  } else if (message.method === 'session/set_mode') {
    send({ method: 'session/update', params: { sessionId: 'config-session', update: { sessionUpdate: 'current_mode_update', currentModeId: message.params.modeId } } });
    send({ id: message.id, result: {} });
  }
});
`;

test("stdio ACP projects each Agent catalog, config changes and mode notifications", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-config-stdio-"));
  const originalPath = process.env.PATH;
  const updates: AcpUpdate[] = [];
  try {
    await writeFile(join(directory, "claude-agent-acp"), fakeConfigAgent, { mode: 0o755 });
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
    const connect = (sessionId?: string) =>
      connectAcpAgent({
        agent: "claude",
        workspacePath: directory,
        sessionId,
        onUpdate: async (update) => {
          updates.push(update);
        },
        onPermission: async () => null,
        onExit: () => {},
      });
    const first = await connect();
    assert.equal(first.configOptions[0]?.id, "model");
    assert.equal(first.configOptions[1]?.type, "boolean");
    assert.equal(first.modeState?.currentModeId, "default");
    assert.doesNotMatch(JSON.stringify(first.configOptions), /must-not-persist|_meta/);
    assert.deepEqual(
      first.configOptions[0]?.type === "select" && first.configOptions[0].options[0],
      {
        group: "family",
        name: "Family",
        options: [
          { value: "one", name: "One", description: "First model" },
          { value: "two", name: "Two" },
        ],
      },
    );
    const changed = await first.setConfigOption("model", "two");
    assert.deepEqual(changed[0]?.type === "select" && changed[0].options, [
      { value: "two", name: "Two" },
    ]);
    await first.setConfigOption("fast", true);
    await first.setMode("plan");
    assert.deepEqual(
      updates.map((update) => update.kind),
      ["config", "config", "mode"],
    );
    assert.equal(updates[2]?.kind === "mode" && updates[2].modeId, "plan");
    first.close();
    await first.closed;
    const resumed = await connect(first.sessionId);
    assert.equal(resumed.configOptions[0]?.currentValue, "two");
    assert.equal(resumed.modeState?.currentModeId, "plan");
    resumed.close();
    await resumed.closed;
  } finally {
    process.env.PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});
