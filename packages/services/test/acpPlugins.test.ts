import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpWorkspace, SkillSummary, ZCodePluginsAcpCapabilitiesResult } from "@zcode/shared";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

const workspace = {
  workspacePath: "/tmp/acp-plugin-test",
  workspaceIdentity: "remote:plugin-a",
  remoteSessionId: "attachment-a",
};
const serverName = "plugin:demo:tool";
const pluginId = "demo@test";
const capability = (
  enabled = true,
  conflictingPluginIds: string[] = [],
): ZCodePluginsAcpCapabilitiesResult => ({
  plugins: [
    {
      pluginId,
      name: "Demo",
      description: "Plugin demo",
      enabled,
      conflictingPluginIds,
      mcpServerNames: [serverName],
    },
  ],
  servers:
    enabled && !conflictingPluginIds.length
      ? [
          {
            pluginId,
            name: serverName,
            rootPath: "/plugins/demo",
            config: { command: process.execPath, env: { TOKEN: "plugin-private-secret" } },
          },
        ]
      : [],
});
const skills: SkillSummary[] = [
  {
    id: "plugin:demo:inspect",
    name: "inspect",
    pluginId,
    enabled: true,
    scope: "plugin",
    description: "Inspect files",
    path: "/plugins/demo/inspect/SKILL.md",
    body: "private skill body",
  },
];
const connection = (prompt: (text: string, blocks?: ContentBlock[]) => Promise<void>) => ({
  sessionId: "native-plugin-session",
  configOptions: [],
  modeState: null,
  provisionedMcpNames: new Set([serverName]),
  async setConfigOption() {
    return [];
  },
  async setMode() {},
  prompt,
  async cancel() {},
  close() {},
});

test("ACP supplies target plugin MCP, keeps original history and rejects disabled references before admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-plugins-"));
  let snapshot = capability();
  let sourceFailure = false;
  let connects = 0;
  const targets: AcpWorkspace[] = [];
  const received: ContentBlock[][] = [];
  const service = createAcpService({
    directory,
    pluginSource: {
      async getAcpPluginCapabilities(target) {
        targets.push(target);
        if (sourceFailure) throw new Error("catalog temporarily unavailable");
        return snapshot;
      },
    },
    skillsService: {
      async list() {
        return { skills, diagnostics: [], capability: { userScopeAvailable: true } };
      },
      async buildPromptContext({ prompt }) {
        return { prompt, activatedSkillNames: [] };
      },
    },
    connect: async ({ pluginServers }) => {
      connects++;
      assert.deepEqual(pluginServers, snapshot.servers);
      return connection(async (_text, blocks) => {
        received.push(blocks ?? []);
      });
    },
  });
  try {
    assert.equal((await service.listPlugins(workspace)).length, 1);
    assert.equal(connects, 0, "opening the plugin picker must not connect/authenticate an Agent");
    const session = await service.create({ ...workspace, agent: "codex" });
    const input = {
      ...workspace,
      id: session.id,
      commandId: crypto.randomUUID(),
      text: "Use [@Demo](plugin://demo@test)",
      attachments: [],
      workspaceFiles: [],
    };
    await service.prompt(input);
    const block = received[0]?.[0];
    assert.equal(block?.type, "text");
    if (block?.type !== "text") throw new Error("Expected plugin text context");
    assert.match(block.text, /<mcp_server name="plugin:demo:tool"/);
    assert.match(block.text, /<skill name="inspect"/);
    assert.doesNotMatch(block.text, /plugin-private-secret|private skill body/);
    const persisted = await readFile(join(directory, `${session.id}.json`), "utf8");
    assert.equal(JSON.parse(persisted).entries[0].text, input.text);
    assert.doesNotMatch(persisted, /available_plugins|plugin-private-secret|private skill body/);
    sourceFailure = true;
    await service.prompt(input);
    assert.equal(
      received.length,
      1,
      "accepted command retry remains idempotent even if plugins changed",
    );
    sourceFailure = false;
    const next = { ...input, commandId: crypto.randomUUID() };
    for (const disabled of [
      capability(false),
      capability(true, ["demo@other"]),
      { plugins: [], servers: [] },
    ]) {
      snapshot = disabled;
      assert.deepEqual(await service.listPlugins({ ...workspace, id: session.id }), []);
      await assert.rejects(service.prompt(next), /停用、卸载/);
      assert.equal((await service.read({ ...workspace, id: session.id })).entries.length, 1);
    }
    snapshot = capability();
    await service.prompt(next);
    assert.equal(
      received.length,
      2,
      "rejected command can be retried after re-enabling the same plugin",
    );
    assert.equal(connects, 1, "plugin references reuse the ACP connection");
    assert.ok(
      targets.every(
        (target) =>
          target.workspaceIdentity === workspace.workspaceIdentity &&
          target.remoteSessionId === workspace.remoteSessionId,
      ),
    );
    await assert.rejects(
      service.listPlugins({ ...workspace, workspaceIdentity: "other-host", id: session.id }),
      /does not belong/,
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP plugin picker honors the live MCP inventory and keeps workspaces isolated on reconnect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-plugins-reconnect-"));
  const other = {
    ...workspace,
    workspaceIdentity: "remote:plugin-b",
    remoteSessionId: "attachment-b",
  };
  let provisioned = new Set<string>();
  const loaded: Array<{ nativeId?: string; names: string[] }> = [];
  const options = {
    directory,
    pluginSource: {
      async getAcpPluginCapabilities(target: AcpWorkspace) {
        return target.workspaceIdentity === workspace.workspaceIdentity
          ? capability()
          : { plugins: [], servers: [] };
      },
    },
    connect: (async ({ sessionId, pluginServers }) => {
      loaded.push({ nativeId: sessionId, names: pluginServers?.map((item) => item.name) ?? [] });
      return { ...connection(async () => {}), provisionedMcpNames: provisioned };
    }) satisfies AcpConnectionFactory,
  };
  let service = createAcpService(options);
  try {
    assert.equal((await service.listPlugins(workspace)).length, 1);
    assert.deepEqual(await service.listPlugins(other), []);
    const session = await service.create({ ...workspace, agent: "claude" });
    assert.deepEqual(await service.listPlugins({ ...workspace, id: session.id }), []);
    await assert.rejects(
      service.prompt({
        ...workspace,
        id: session.id,
        commandId: crypto.randomUUID(),
        text: "[@Demo](plugin://demo@test)",
        attachments: [],
        workspaceFiles: [],
      }),
      /不可用/,
    );
    assert.equal((await service.read({ ...workspace, id: session.id })).entries.length, 0);
    await service.disposeAllAndWait();
    provisioned = new Set([serverName]);
    service = createAcpService(options);
    await service.refresh({ ...workspace, id: session.id });
    assert.equal((await service.listPlugins({ ...workspace, id: session.id })).length, 1);
    assert.deepEqual(loaded, [
      { nativeId: undefined, names: [serverName] },
      { nativeId: "native-plugin-session", names: [serverName] },
    ]);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
