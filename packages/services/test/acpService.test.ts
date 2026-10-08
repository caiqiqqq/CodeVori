import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  createAcpService,
  type AcpConnectionFactory,
  type AcpUpdate,
} from "../src/acp/acpServiceImpl.js";
import { AcpSessionLoadError } from "../src/acp/acpStdioConnection.js";

const workspace = { workspacePath: "/tmp/acp-example", workspaceIdentity: "remote:ssh:example" };

test("ACP ready snapshots merge initial capacity and prefer newer live notifications", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-ready-context-"));
  let initialUsage: AcpSession["contextUsage"] | undefined = { used: 9000, size: 200000 };
  let liveUsage: AcpSession["contextUsage"] | undefined;
  let failLoad = false;
  const connect: AcpConnectionFactory = async ({ agent, sessionId, onUpdate }) => {
    if (failLoad) throw new AcpSessionLoadError(new Error("fixture restore failed"));
    if (liveUsage !== undefined) await onUpdate({ kind: "context_usage", usage: liveUsage });
    return {
      sessionId: sessionId ?? `native-${agent}`,
      contextUsage: initialUsage,
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    };
  };
  let service = createAcpService({ directory, connect });
  try {
    const codex = await service.create({ ...workspace, agent: "codex" });
    assert.deepEqual(codex.contextUsage, initialUsage);
    assert.deepEqual(codex.entries, []);
    assert.deepEqual(await service.getUsageStats({ range: "all" }), []);
    service.disposeAll();
    service = createAcpService({ directory, connect });
    assert.deepEqual(
      (await service.read({ ...workspace, id: codex.id })).contextUsage,
      initialUsage,
    );

    initialUsage = undefined;
    assert.deepEqual(
      (await service.refresh({ ...workspace, id: codex.id })).contextUsage,
      {
        used: 9000,
        size: 200000,
      },
      "absence of a resume report preserves this saved session's value",
    );
    service.disposeAll();
    service = createAcpService({ directory, connect });
    initialUsage = { used: 15000, size: 200000 };
    assert.deepEqual(
      (await service.refresh({ ...workspace, id: codex.id })).contextUsage,
      initialUsage,
    );

    service.disposeAll();
    service = createAcpService({ directory, connect });
    liveUsage = { used: 19000, size: 200000 };
    assert.deepEqual(
      (await service.refresh({ ...workspace, id: codex.id })).contextUsage,
      liveUsage,
      "a newer live update must not be overwritten by the initial snapshot",
    );
    service.disposeAll();
    service = createAcpService({ directory, connect });
    liveUsage = undefined;
    initialUsage = null;
    assert.equal((await service.refresh({ ...workspace, id: codex.id })).contextUsage, null);

    service.disposeAll();
    service = createAcpService({ directory, connect });
    initialUsage = { used: 21000, size: 200000 };
    await service.refresh({ ...workspace, id: codex.id });
    service.disposeAll();
    service = createAcpService({ directory, connect });
    failLoad = true;
    await assert.rejects(service.refresh({ ...workspace, id: codex.id }));
    assert.deepEqual(
      (await service.read({ ...workspace, id: codex.id })).contextUsage,
      initialUsage,
    );
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP context capacity belongs to the selected Host session and survives snapshot replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-context-"));
  const updates: Array<{ agent: string; send: (update: AcpUpdate) => Promise<void> }> = [];
  const connect: AcpConnectionFactory = async ({ agent, sessionId, onUpdate }) => {
    updates.push({ agent, send: onUpdate });
    return {
      sessionId: sessionId ?? `native-${agent}`,
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    };
  };
  let service = createAcpService({ directory, connect });
  try {
    const codex = await service.create({ ...workspace, agent: "codex" });
    const claude = await service.create({ ...workspace, agent: "claude" });
    assert.equal(codex.contextUsage, null);
    assert.equal(claude.contextUsage, null);
    const revisions: number[] = [];
    const subscription = service.onDynamicSessionChanged(workspace)((change) => {
      if (change.kind === "updated" && change.session.id === codex.id)
        revisions.push(change.session.revision);
    });
    await updates[0].send({ kind: "context_usage", usage: { used: 9000, size: 200000 } });
    assert.deepEqual((await service.read({ ...workspace, id: codex.id })).contextUsage, {
      used: 9000,
      size: 200000,
    });
    assert.equal((await service.read({ ...workspace, id: claude.id })).contextUsage, null);
    assert.deepEqual(
      await service.getUsageStats({ range: "all" }),
      [],
      "current context occupancy must not become cumulative token spend",
    );
    assert.equal(revisions.at(-1), codex.revision + 1);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, `${codex.id}.json`), "utf8")).contextUsage,
      { used: 9000, size: 200000 },
    );
    await assert.rejects(
      service.read({ ...workspace, workspaceIdentity: "different", id: codex.id }),
    );

    await updates[0].send({ kind: "context_usage", usage: null });
    assert.equal(
      (await service.read({ ...workspace, id: codex.id })).contextUsage,
      null,
      "an unknown report must hide the previous value",
    );
    await updates[0].send({ kind: "context_usage", usage: { used: 5000, size: 200000 } });
    assert.equal(await service.prepareWorktreeRemoval(workspace), true);
    await service.refresh({ ...workspace, id: codex.id });
    await updates[0].send({ kind: "context_usage", usage: { used: 1, size: 1 } });
    assert.deepEqual(
      (await service.read({ ...workspace, id: codex.id })).contextUsage,
      { used: 5000, size: 200000 },
      "old process updates must not override the current snapshot",
    );
    await updates.at(-1)!.send({ kind: "context_usage", usage: { used: 7000, size: 200000 } });
    subscription.dispose();
    service.disposeAll();
    service = createAcpService({ directory, connect });
    assert.deepEqual((await service.read({ ...workspace, id: codex.id })).contextUsage, {
      used: 7000,
      size: 200000,
    });
    assert.equal((await service.read({ ...workspace, id: claude.id })).contextUsage, null);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP Host reads target MCP settings on connection and injects only explicitly named skills into the wire prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-config-context-"));
  const mcpRecords = [
    {
      source: "zcodeagentmcp" as const,
      scope: "user" as const,
      name: "demo",
      config: { command: "/usr/bin/demo" },
      enabled: true,
    },
  ];
  const connected: Array<{ path: string; names: string[] }> = [];
  const received: ContentBlock[][] = [];
  const skillPrompts: string[] = [];
  const service = createAcpService({
    directory,
    mcpSyncService: {
      async loadMcpFromUserDirectory({ workspacePath } = {}) {
        assert.equal(workspacePath, workspace.workspacePath);
        return { servers: mcpRecords };
      },
    },
    skillsService: {
      async buildPromptContext(input) {
        skillPrompts.push(input.prompt);
        assert.equal(input.workspaceIdentity, workspace.workspaceIdentity);
        return {
          prompt: input.prompt.includes("$demo")
            ? `${input.prompt}\n\n<activated_skill>private body</activated_skill>`
            : input.prompt,
          activatedSkillNames: input.prompt.includes("$demo") ? ["demo"] : [],
        };
      },
    },
    connect: async ({ workspacePath, mcpServers }) => {
      connected.push({ path: workspacePath, names: mcpServers?.map((item) => item.name) ?? [] });
      return {
        sessionId: "native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt(_text, blocks) {
          received.push(blocks ?? []);
        },
        async cancel() {},
        close() {},
      };
    },
  });
  try {
    const created = await service.create({ ...workspace, agent: "codex" });
    assert.deepEqual(connected, [{ path: workspace.workspacePath, names: ["demo"] }]);
    await service.prompt({
      ...workspace,
      id: created.id,
      commandId: crypto.randomUUID(),
      text: "use $demo",
      attachments: [],
      workspaceFiles: [],
    });
    await service.prompt({
      ...workspace,
      id: created.id,
      commandId: crypto.randomUUID(),
      text: "hello",
      attachments: [],
      workspaceFiles: [],
    });
    assert.deepEqual(skillPrompts, ["use $demo", "hello"]);
    const firstBlock = received[0]?.[0];
    assert.equal(firstBlock?.type, "text");
    if (firstBlock?.type !== "text") throw new Error("Expected an ACP text block");
    assert.match(firstBlock.text, /private body/);
    assert.deepEqual(received[1], [{ type: "text", text: "hello" }]);
    const saved = await service.read({ ...workspace, id: created.id });
    assert.equal(saved.entries[0]?.kind, "user");
    assert.equal(saved.entries[0]?.text, "use $demo");
    assert.ok(!JSON.stringify(saved).includes("private body"));
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP recovery reads current target MCP settings and skill-read failure stays before admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-config-recovery-"));
  let name = "first";
  let skillFailure = false;
  let prompts = 0;
  const connections: Array<{ sessionId?: string; name?: string }> = [];
  const options = {
    directory,
    mcpSyncService: {
      async loadMcpFromUserDirectory() {
        return {
          servers: [
            {
              source: "zcodeagentmcp" as const,
              scope: "user" as const,
              name,
              config: { command: "/usr/bin/demo" },
              enabled: true,
            },
          ],
        };
      },
    },
    skillsService: {
      async buildPromptContext({ prompt }: { prompt: string }) {
        if (skillFailure) throw new Error("Skill read failed");
        return { prompt, activatedSkillNames: [] };
      },
    },
    connect: (async ({ sessionId, mcpServers }) => {
      connections.push({ sessionId, name: mcpServers?.[0]?.name });
      return {
        sessionId: "native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {
          prompts += 1;
        },
        async cancel() {},
        close() {},
      };
    }) satisfies AcpConnectionFactory,
  };
  let service = createAcpService(options);
  try {
    const session = await service.create({ ...workspace, agent: "claude" });
    const commandId = crypto.randomUUID();
    const input = {
      ...workspace,
      id: session.id,
      commandId,
      text: "first",
      attachments: [],
      workspaceFiles: [],
    };
    await service.prompt(input);
    await service.prompt(input);
    assert.equal(prompts, 1, "repeated command must not rebuild or send the accepted prompt");
    service.disposeAll();
    name = "updated";
    service = createAcpService(options);
    await service.refresh({ ...workspace, id: session.id });
    assert.deepEqual(connections, [
      { sessionId: undefined, name: "first" },
      { sessionId: "native", name: "updated" },
    ]);
    skillFailure = true;
    const next = { ...input, commandId: crypto.randomUUID(), text: "$demo" };
    await assert.rejects(service.prompt(next), /Skill read failed/);
    assert.equal((await service.read({ ...workspace, id: session.id })).entries.length, 1);
    assert.equal(prompts, 1);
    skillFailure = false;
    await service.prompt(next);
    assert.equal(prompts, 2);
    assert.equal((await service.read({ ...workspace, id: session.id })).entries.length, 2);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP row actions persist on the scoped Host without changing activity time or connecting an Agent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-row-actions-"));
  const id = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const snapshot = {
    ...workspace,
    id,
    agent: "codex",
    acpSessionId: "agent-internal-id",
    status: "idle",
    revision: 1,
    title: "Original",
    goal: null,
    configOptions: [],
    modeState: null,
    entries: [{ id: "user:first", kind: "user", text: "first", createdAt: 100 }],
    pendingPermission: null,
    error: null,
  };
  await writeFile(join(dir, `${id}.json`), JSON.stringify(snapshot));
  await writeFile(join(dir, `${otherId}.json`), JSON.stringify({ ...snapshot, id: otherId }));
  let service = createAcpService({
    directory: dir,
    connect: async () => {
      throw new Error("no Agent connection expected");
    },
  });
  try {
    const revisions: number[] = [];
    const subscription = service.onDynamicSessionChanged(workspace)((change) => {
      if (change.kind === "updated" && change.session.id === id)
        revisions.push(change.session.revision);
    });
    await assert.rejects(
      service.updateRow({
        ...workspace,
        workspaceIdentity: "other-host",
        id,
        action: { kind: "pin", pinned: true },
      }),
      /does not belong/,
    );
    await assert.rejects(
      service.updateRow({ ...workspace, id, action: { kind: "rename", title: "   " } }),
      /title/,
    );
    await service.updateRow({ ...workspace, id, action: { kind: "pin", pinned: true } });
    await service.updateRow({ ...workspace, id, action: { kind: "rename", title: "  Renamed  " } });
    await service.updateRow({ ...workspace, id, action: { kind: "unread", unread: true } });
    const after = await service.updateRow({
      ...workspace,
      id,
      action: { kind: "unread", unread: false },
    });
    assert.equal(after.title, "Renamed");
    assert.equal(after.pinned, true);
    assert.equal(after.unreadAt, null);
    assert.deepEqual(after.entries, snapshot.entries);
    assert.deepEqual(revisions, [2, 3, 4, 5]);
    assert.equal(await service.getSessionFilePath({ ...workspace, id }), join(dir, `${id}.json`));
    await assert.rejects(
      service.getSessionFilePath({ ...workspace, workspaceIdentity: "other-host", id }),
      /does not belong/,
    );
    const archived = await service.updateRow({
      ...workspace,
      id,
      action: { kind: "archive", archived: true },
    });
    assert.equal(archived.archived, true);
    assert.equal(archived.pinned, false);
    assert.equal(archived.entries[0]?.createdAt, 100);
    assert.deepEqual(revisions, [2, 3, 4, 5, 6]);
    assert.equal(JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")).archived, true);
    const restartedWhileArchived = createAcpService({ directory: dir });
    try {
      assert.equal((await restartedWhileArchived.read({ ...workspace, id })).archived, true);
    } finally {
      restartedWhileArchived.disposeAll();
    }
    await service.updateRow({ ...workspace, id, action: { kind: "archive", archived: true } });
    assert.deepEqual(revisions, [2, 3, 4, 5, 6], "repeat archive does not publish a new revision");
    assert.equal(
      (await service.search({ ...workspace, query: "first" })).some((item) => item.id === id),
      false,
    );
    await assert.rejects(
      service.updateRow({ ...workspace, id, action: { kind: "pin", pinned: true } }),
      /Archived ACP session cannot be pinned/,
    );
    assert.deepEqual(
      revisions,
      [2, 3, 4, 5, 6],
      "pin cannot move archived history into pinned list",
    );
    await service.updateRow({ ...workspace, id, action: { kind: "archive", archived: false } });
    assert.equal(
      (await service.search({ ...workspace, query: "first" })).some((item) => item.id === id),
      true,
    );
    assert.deepEqual(revisions, [2, 3, 4, 5, 6, 7]);
    assert.equal((await service.read({ ...workspace, id: otherId })).pinned, false);
    subscription.dispose();
    service.disposeAll();
    service = createAcpService({ directory: dir });
    const reloaded = await service.read({ ...workspace, id });
    assert.equal(reloaded.title, "Renamed");
    assert.equal(reloaded.pinned, false);
    assert.equal(reloaded.unreadAt, null);
    assert.equal(reloaded.archived, false);
    assert.equal(reloaded.revision, 7);
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP diagnostics are scoped, contain ordered event metadata, and are removed with the session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-diagnostics-"));
  const privatePrompt = "SECRET-PROMPT-CONTENT";
  const privateTool = "SECRET-TOOL-CONTENT";
  const service = createAcpService({
    directory: dir,
    connect: async ({ onUpdate }) => ({
      sessionId: "adapter-session",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        await onUpdate({ kind: "text", text: "SECRET-ASSISTANT-CONTENT" });
        await onUpdate({
          kind: "tool",
          id: "tool-1",
          title: privateTool,
          status: "completed",
          content: privateTool,
        });
      },
      async cancel() {},
      close() {},
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    await assert.rejects(service.getDiagnosticLogPath({ ...workspace, id: session.id }), /durable/);
    await service.prompt({
      ...workspace,
      id: session.id,
      commandId: crypto.randomUUID(),
      text: privatePrompt,
      attachments: [],
      workspaceFiles: [],
    });
    await assert.rejects(
      service.getDiagnosticLogPath({
        ...workspace,
        workspaceIdentity: "other-host",
        id: session.id,
      }),
      /does not belong/,
    );
    const path = await service.getDiagnosticLogPath({ ...workspace, id: session.id });
    const raw = await readFile(path, "utf8");
    assert.ok(raw.includes('"kind":"prompt-accepted"'));
    assert.ok(raw.includes('"kind":"tool-update"'));
    assert.ok(raw.includes('"kind":"turn-completed"'));
    assert.ok(
      !raw.includes(privatePrompt) &&
        !raw.includes(privateTool) &&
        !raw.includes("SECRET-ASSISTANT"),
    );
    const trace = await service.getExecutionTrace({ ...workspace, id: session.id });
    assert.deepEqual(
      trace.map((event) => event.kind),
      ["prompt-accepted", "tool-update", "turn-completed"],
    );
    const restarted = createAcpService({ directory: dir });
    try {
      assert.deepEqual(await restarted.getExecutionTrace({ ...workspace, id: session.id }), trace);
    } finally {
      restarted.disposeAll();
    }
    await service.remove({ ...workspace, id: session.id });
    await assert.rejects(readFile(path, "utf8"), /ENOENT/);
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy ACP history creates an empty diagnostic file only when explicitly requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-legacy-diagnostics-"));
  const id = crypto.randomUUID();
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({
      ...workspace,
      id,
      agent: "codex",
      acpSessionId: "existing-adapter-session",
      status: "idle",
      revision: 1,
      title: "History",
      goal: null,
      configOptions: [],
      modeState: null,
      entries: [{ kind: "user", id: "user:old", text: "old prompt" }],
      pendingPermission: null,
      error: null,
    }),
  );
  const service = createAcpService({ directory: dir });
  try {
    const path = await service.getDiagnosticLogPath({ ...workspace, id });
    assert.equal(await readFile(path, "utf8"), "");
    assert.deepEqual(await service.getExecutionTrace({ ...workspace, id }), []);
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("undated legacy ACP history freezes its snapshot time without inventing entry dates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-legacy-time-"));
  const id = crypto.randomUUID();
  const time = Date.UTC(2025, 0, 2, 3, 4, 5);
  const snapshot = {
    ...workspace,
    id,
    agent: "codex",
    acpSessionId: "legacy-agent-session",
    status: "idle",
    revision: 1,
    title: "Previous conversation",
    goal: null,
    configOptions: [],
    modeState: null,
    entries: [{ id: "user:old", kind: "user", text: "old" }],
    pendingPermission: null,
    error: null,
  };
  let service: ReturnType<typeof createAcpService> | undefined;
  try {
    const path = join(dir, `${id}.json`);
    await writeFile(path, JSON.stringify(snapshot));
    await utimes(path, time / 1000, time / 1000);
    service = createAcpService({ directory: dir });
    const [migrated] = await service.list(workspace);
    assert.equal(migrated?.legacySavedAt, time);
    assert.deepEqual(migrated?.entries, snapshot.entries);
    assert.ok((migrated?.revision ?? 0) > snapshot.revision);
    await service.setGoal({ ...workspace, id, goal: "later change" });
    const afterGoal = (await service.list(workspace))[0];
    service.disposeAll();
    service = createAcpService({ directory: dir });
    const reloaded = (await service.list(workspace))[0];
    assert.equal(reloaded?.legacySavedAt, time);
    assert.equal(reloaded?.revision, afterGoal?.revision);
    assert.equal(JSON.parse(await readFile(path, "utf8")).legacySavedAt, time);
  } finally {
    service?.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP Host persists message timestamps once while tool and text updates reuse entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-entry-time-"));
  let update: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  let initialToolTime: number | undefined;
  const factory: AcpConnectionFactory = async (input) => {
    update = input.onUpdate;
    return {
      sessionId: "entry-time-session",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        await update({ kind: "text", text: "one" });
        await update({ kind: "tool", id: "tool", title: "Example tool", status: "in_progress" });
        initialToolTime = (await service.list(workspace))[0]?.entries.find(
          (entry) => entry.kind === "tool",
        )?.createdAt;
        await update({ kind: "tool", id: "tool", status: "completed", content: "done" });
        await update({ kind: "text", text: "two" });
        await update({ kind: "text", text: "three" });
      },
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({ directory: dir, connect: factory });
  try {
    const created = await service.create({
      ...workspace,
      agent: "codex",
      requestId: crypto.randomUUID(),
    });
    const result = await service.prompt({
      ...workspace,
      id: created.id,
      commandId: crypto.randomUUID(),
      text: "test",
    });
    assert.deepEqual(
      result.entries.map((entry) => entry.kind),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(result.entries[2]?.createdAt, initialToolTime);
    assert.equal(result.entries[3]?.kind === "assistant" && result.entries[3].text, "twothree");
    assert.equal(
      result.entries.every((entry) => typeof entry.createdAt === "number" && entry.createdAt > 0),
      true,
    );
    const reloaded = createAcpService({ directory: dir, connect: factory });
    const [saved] = await reloaded.list(workspace);
    assert.deepEqual(saved?.entries, result.entries);
    service.disposeAll();
    reloaded.disposeAll();
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP preconnect exposes Agent options without history; the first prompt persists its session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-preconnect-"));
  const calls: string[] = [];
  const factory: AcpConnectionFactory = async ({ sessionId }) => {
    calls.push(sessionId ? `load:${sessionId}` : "new");
    return {
      sessionId: "preconnected-id",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "base",
          options: [
            { value: "base", name: "Base" },
            { value: "fast", name: "Fast" },
          ],
        },
      ],
      modeState: null,
      async setConfigOption(_id, value) {
        calls.push(`config:${value}`);
        return [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: String(value),
            options: [
              { value: "base", name: "Base" },
              { value: "fast", name: "Fast" },
            ],
          },
        ];
      },
      async setMode() {},
      async prompt(text) {
        calls.push(`prompt:${text}`);
      },
      async cancel() {},
      close() {
        calls.push("close");
      },
    };
  };
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    const input = {
      ...workspace,
      agent: "codex" as const,
      requestId: "d137ca1d-f47f-46de-b437-e67186524e20",
      deferPersistence: true,
    };
    const [draft, duplicate] = await Promise.all([service.create(input), service.create(input)]);
    assert.equal(draft.id, duplicate.id);
    assert.equal(draft.provisional, true);
    assert.equal(draft.configOptions[0]?.currentValue, "base");
    assert.deepEqual(await service.list(workspace), []);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".json")),
      [],
    );
    await assert.rejects(
      service.updateRow({
        ...workspace,
        id: draft.id,
        action: { kind: "pin", pinned: true },
      }),
      /no durable history/,
    );
    await service.setConfigOption({ ...workspace, id: draft.id, configId: "model", value: "fast" });
    assert.equal(
      (await service.read({ ...workspace, id: draft.id })).configOptions[0]?.currentValue,
      "fast",
    );
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".json")),
      [],
    );
    await service.prompt({ ...workspace, id: draft.id, commandId: "first", text: "hello" });
    assert.deepEqual(calls, ["new", "config:fast", "prompt:hello"]);
    assert.equal((await service.list(workspace))[0]?.id, draft.id);
    const saved = JSON.parse(await readFile(join(dir, `${draft.id}.json`), "utf8"));
    assert.equal(saved.provisional, undefined);
    assert.equal(saved.entries[0].text, "hello");
    await service.remove({ ...workspace, id: draft.id, provisionalOnly: true });
    assert.equal((await service.read({ ...workspace, id: draft.id })).entries[0]?.text, "hello");
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP provisional session is discarded without leaving a conversation file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-discard-draft-"));
  let closed = 0;
  const factory: AcpConnectionFactory = async () => ({
    sessionId: "draft",
    configOptions: [],
    modeState: null,
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt() {},
    async cancel() {},
    close() {
      closed++;
    },
  });
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    const draft = await service.create({ ...workspace, agent: "claude", deferPersistence: true });
    await service.remove({ ...workspace, id: draft.id, provisionalOnly: true });
    assert.equal(closed, 1);
    assert.deepEqual(await service.list(workspace), []);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".json")),
      [],
    );
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP first-send create is single-flight and survives an ambiguous ACK and Host restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-create-on-send-"));
  const requestId = "ed4a63c0-1241-4e89-a42d-ad117b79fe34";
  const calls: string[] = [];
  const factory: AcpConnectionFactory = async ({ agent }) => {
    calls.push(agent);
    return {
      sessionId: "native-id",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt(text) {
        calls.push(text);
      },
      async cancel() {},
      close() {},
    };
  };
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    assert.deepEqual(await service.list(workspace), []);
    assert.deepEqual(calls, []);
    const input = { ...workspace, agent: "qoder" as const, requestId };
    const [first, duplicate] = await Promise.all([service.create(input), service.create(input)]);
    assert.equal(first.id, duplicate.id);
    assert.deepEqual(calls, ["qoder"]);
    await service.prompt({ ...workspace, id: first.id, commandId: "first-send", text: "hello" });
    service.disposeAll();

    const restarted = createAcpService({ directory: dir, connect: factory });
    const recovered = await restarted.create(input);
    assert.equal(recovered.id, first.id);
    assert.deepEqual(calls, ["qoder", "hello"]);
    await restarted.prompt({
      ...workspace,
      id: recovered.id,
      commandId: "first-send",
      text: "hello",
    });
    assert.deepEqual(calls, ["qoder", "hello"]);
    restarted.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP preconnection authentication failure leaves no history and retry keeps the request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-auth-on-send-"));
  let connected = 0;
  const factory: AcpConnectionFactory = async () => {
    connected++;
    throw new Error("Authentication required");
  };
  const input = {
    ...workspace,
    agent: "qoder" as const,
    requestId: "cb6a9377-99e8-4bd1-a9b3-627b264271c7",
  };
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    assert.deepEqual(await service.list(workspace), []);
    assert.equal(connected, 0);
    await assert.rejects(
      service.create({ ...input, deferPersistence: true }),
      /Authentication required/,
    );
    await assert.rejects(
      service.create({ ...input, deferPersistence: true }),
      /Authentication required/,
    );
    assert.equal(connected, 2);
    assert.deepEqual(await service.list(workspace), []);
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP goal persists while prompt blocks and attachment bytes never enter the snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-content-"));
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-files-"));
  const received: ContentBlock[][] = [];
  const target = { workspacePath: root };
  const factory: AcpConnectionFactory = async () => ({
    sessionId: "native-id",
    promptCapabilities: { image: true, embeddedContext: true },
    async prompt(_text, blocks) {
      received.push(blocks ?? []);
    },
    async cancel() {},
    close() {},
  });
  try {
    await writeFile(join(root, "notes.txt"), "document");
    const service = createAcpService({ directory: dir, connect: factory });
    const session = await service.create({ ...target, agent: "codex" });
    await service.setGoal({ ...target, id: session.id, goal: "Summarize accurately" });
    const input = {
      ...target,
      id: session.id,
      commandId: "one",
      text: "Read the image and notes",
      workspaceFiles: ["notes.txt"],
      attachments: [{ fileName: "pixel.png", mimeType: "image/png", dataBase64: "cG5n" }],
    };
    await service.prompt(input);
    await service.prompt(input);
    assert.equal(received.length, 1);
    assert.deepEqual(
      received[0]?.map((block) => block.type),
      ["text", "text", "resource_link", "image"],
    );
    assert.deepEqual(received[0]?.[0], {
      type: "text",
      text: "Session objective: Summarize accurately",
    });
    const snapshot = await service.read({ ...target, id: session.id });
    assert.equal(snapshot.goal, "Summarize accurately");
    const entry = snapshot.entries[0];
    assert.equal(entry?.kind, "user");
    if (entry?.kind !== "user") throw new Error("missing input");
    const ref = entry.attachments?.[0]?.ref;
    assert.match(ref ?? "", /^acp-attachment:[0-9a-f-]{36}\/0$/i);
    assert.deepEqual(snapshot.entries[0], {
      id: "user:one",
      kind: "user",
      text: "Read the image and notes",
      createdAt: snapshot.entries[0]?.createdAt,
      attachmentNames: ["pixel.png", "notes.txt"],
      attachments: [{ ref, fileName: "pixel.png", mime: "image/png", bytes: 3 }],
    });
    assert.doesNotMatch(JSON.stringify(snapshot), /cG5n|zcode-attachment/);
    const restarted = createAcpService({ directory: dir, connect: factory });
    assert.equal(
      (await restarted.read({ ...target, id: session.id })).goal,
      "Summarize accurately",
    );
    await restarted.setGoal({ ...target, id: session.id, goal: null });
    await restarted.prompt({ ...target, id: session.id, commandId: "two", text: "continue" });
    assert.deepEqual(received[1], [{ type: "text", text: "continue" }]);
    service.disposeAll();
    restarted.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP config is Agent-owned, validates choices and refreshes the full catalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-config-"));
  const calls: string[] = [];
  const connect: AcpConnectionFactory = async ({ agent, onUpdate }) => ({
    sessionId: `${agent}-native`,
    modeState:
      agent === "codex"
        ? null
        : {
            currentModeId: "default",
            availableModes: [
              { id: "default", name: "Manual" },
              { id: "plan", name: "Plan" },
            ],
          },
    configOptions:
      agent === "codex"
        ? [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "sol",
              options: [
                { value: "sol", name: "Sol" },
                { value: "luna", name: "Luna" },
              ],
            },
          ]
        : [],
    async setConfigOption(configId, value) {
      calls.push(`${agent}:${configId}:${value}`);
      if (agent === "codex") {
        const next = [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select" as const,
            currentValue: String(value),
            options: [{ value: "luna", name: "Luna" }],
          },
        ];
        await onUpdate({ kind: "config", configOptions: next });
        return next;
      }
      return [];
    },
    async setMode(modeId) {
      calls.push(`${agent}:mode:${modeId}`);
    },
    async prompt() {},
    async cancel() {},
    close() {},
  });
  try {
    const service = createAcpService({ directory: dir, connect });
    const codex = await service.create({ ...workspace, agent: "codex" });
    const claude = await service.create({ ...workspace, agent: "claude" });
    assert.equal(codex.configOptions[0]?.id, "model");
    assert.equal(claude.configOptions.length, 0);
    assert.equal(claude.modeState?.availableModes[1]?.id, "plan");
    await assert.rejects(
      service.setConfigOption({ ...workspace, id: codex.id, configId: "model", value: "unknown" }),
      /not available/,
    );
    await assert.rejects(
      service.setConfigOption({ ...workspace, id: claude.id, configId: "model", value: "sol" }),
      /not available/,
    );
    assert.deepEqual(calls, []);
    const changed = await service.setConfigOption({
      ...workspace,
      id: codex.id,
      configId: "model",
      value: "luna",
    });
    assert.equal(changed.configOptions[0]?.currentValue, "luna");
    assert.deepEqual(changed.configOptions[0]?.options, [{ value: "luna", name: "Luna" }]);
    const mode = await service.setConfigOption({
      ...workspace,
      id: claude.id,
      configId: "mode",
      value: "plan",
    });
    assert.equal(mode.modeState?.currentModeId, "plan");
    assert.deepEqual(calls, ["codex:model:luna", "claude:mode:plan"]);
    const savedPath = join(dir, `${codex.id}.json`);
    const saved = JSON.parse(await readFile(savedPath, "utf8"));
    assert.equal(saved.configOptions[0].currentValue, "luna");
    // 升级前的快照没有配置字段；加载后仍使用原会话 ID 取最新目录。
    delete saved.configOptions;
    delete saved.modeState;
    await writeFile(savedPath, JSON.stringify(saved));
    const restarted = createAcpService({ directory: dir, connect });
    assert.deepEqual((await restarted.read({ ...workspace, id: codex.id })).configOptions, []);
    // session/load 的 Agent 目录覆盖旧快照，旧会话无需重建。
    const refreshed = await restarted.refresh({ ...workspace, id: codex.id });
    assert.equal(refreshed.configOptions[0]?.currentValue, "sol");
    await assert.rejects(restarted.refresh({ workspacePath: "/tmp/other", id: codex.id }));
    service.disposeAll();
    restarted.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a restarted Host skips untouched idle ACP sessions but preserves meaningful history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-idle-restart-"));
  const seen: string[] = [];
  const connect: AcpConnectionFactory = async ({ agent, sessionId }) => {
    seen.push(`${agent}:${sessionId ?? "new"}`);
    if (sessionId) throw new AcpSessionLoadError(new Error(`Resource not found: ${sessionId}`));
    return {
      sessionId: `${agent}-native-${seen.length}`,
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "other", name: "Other" },
          ],
        },
      ],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    };
  };
  const service = createAcpService({ directory: dir, connect });
  let restarted: ReturnType<typeof createAcpService> | undefined;
  try {
    const pristine = await Promise.all(
      (["claude", "codex", "deepseek"] as const).map((agent) =>
        service.create({ ...workspace, agent }),
      ),
    );
    const withGoal = await service.create({ ...workspace, agent: "claude" });
    await service.setGoal({ ...workspace, id: withGoal.id, goal: "Keep this objective" });
    const withConfig = await service.create({ ...workspace, agent: "codex" });
    await service.setConfigOption({
      ...workspace,
      id: withConfig.id,
      configId: "model",
      value: "other",
    });
    assert.equal((await service.list(workspace)).length, 5);
    service.disposeAll();

    seen.length = 0;
    restarted = createAcpService({ directory: dir, connect });
    const listed = await restarted.list(workspace);
    assert.deepEqual(listed.map(({ id }) => id).sort(), [withGoal.id, withConfig.id].sort());
    assert.deepEqual(seen, []);
    for (const session of pristine) {
      assert.equal(
        JSON.parse(await readFile(join(dir, `${session.id}.json`), "utf8")).id,
        session.id,
      );
    }
    const fresh = await restarted.create({ ...workspace, agent: "codex" });
    assert.deepEqual(seen, ["codex:new"]);
    assert.deepEqual(
      (await restarted.list(workspace)).map(({ id }) => id).sort(),
      [withGoal.id, withConfig.id, fresh.id].sort(),
    );
    await assert.rejects(
      restarted.refresh({ ...workspace, id: withGoal.id }),
      /Resource not found/,
    );
    assert.equal(
      (await restarted.read({ ...workspace, id: withGoal.id })).goal,
      "Keep this objective",
    );
  } finally {
    restarted?.disposeAll();
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP replaces a stale empty configured session once and retains its original snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-empty-recovery-"));
  const calls: string[] = [];
  let failNew = false;
  const connect: AcpConnectionFactory = async ({ sessionId }) => {
    calls.push(sessionId ? "load" : "new");
    if (sessionId === "auth-only") throw new Error("Authentication required");
    if (sessionId) throw new AcpSessionLoadError(new Error("Internal error"));
    if (failNew) throw new Error("Missing API key");
    return {
      sessionId: `native-${calls.length}`,
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "other", name: "Other" },
          ],
        },
      ],
      modeState: null,
      async setConfigOption(_id, value) {
        calls.push(`set:${value}`);
        return [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: String(value),
            options: [
              { value: "default", name: "Default" },
              { value: "other", name: "Other" },
            ],
          },
        ];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    };
  };
  const first = createAcpService({ directory: dir, connect });
  let restarted: ReturnType<typeof createAcpService> | undefined;
  try {
    const old = await first.create({ ...workspace, agent: "codex" });
    await first.setConfigOption({
      ...workspace,
      id: old.id,
      configId: "model",
      value: "other",
    });
    await first.setGoal({ ...workspace, id: old.id, goal: "temporary" });
    await first.setGoal({ ...workspace, id: old.id, goal: null });
    assert.ok((await first.read({ ...workspace, id: old.id })).revision > 1);
    first.disposeAll();
    calls.length = 0;
    restarted = createAcpService({ directory: dir, connect });
    const [a, b] = await Promise.all([
      restarted.refresh({ ...workspace, id: old.id }),
      restarted.refresh({ ...workspace, id: old.id }),
    ]);
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, old.id);
    assert.equal(a.configOptions[0]?.currentValue, "other");
    assert.deepEqual(calls, ["load", "new", "set:other"]);
    const original = await restarted.read({ ...workspace, id: old.id });
    assert.equal(original.acpSessionId, old.acpSessionId);
    assert.equal(original.configOptions[0]?.currentValue, "other");
    assert.equal(original.supersededBy, a.id);
    assert.deepEqual(
      (await restarted.list(workspace)).map((session) => session.id),
      [a.id],
    );
    assert.equal(
      JSON.parse(await readFile(join(dir, `${old.id}.json`), "utf8")).acpSessionId,
      old.acpSessionId,
    );
    assert.equal((await restarted.refresh({ ...workspace, id: old.id })).id, a.id);

    failNew = true;
    const stale = {
      ...old,
      id: crypto.randomUUID(),
      acpSessionId: "missing",
      supersededBy: undefined,
    };
    await writeFile(join(dir, `${stale.id}.json`), JSON.stringify(stale));
    await assert.rejects(restarted.refresh({ ...workspace, id: stale.id }), /Missing API key/);
    assert.equal((await restarted.read({ ...workspace, id: stale.id })).supersededBy, undefined);
    failNew = false;
    const auth = { ...stale, id: crypto.randomUUID(), acpSessionId: "auth-only" };
    await writeFile(join(dir, `${auth.id}.json`), JSON.stringify(auth));
    const beforeAuth = calls.length;
    await assert.rejects(
      restarted.refresh({ ...workspace, id: auth.id }),
      /Authentication required/,
    );
    assert.deepEqual(calls.slice(beforeAuth), ["load"]);
    const withHistory = {
      ...stale,
      id: crypto.randomUUID(),
      entries: [{ id: "user:one", kind: "user", text: "keep my history" }],
    };
    await writeFile(join(dir, `${withHistory.id}.json`), JSON.stringify(withHistory));
    const beforeHistory = calls.length;
    await assert.rejects(restarted.refresh({ ...workspace, id: withHistory.id }), /Internal error/);
    assert.deepEqual(calls.slice(beforeHistory), ["load"]);
    assert.equal((await restarted.read({ ...workspace, id: withHistory.id })).entries.length, 1);
  } finally {
    restarted?.disposeAll();
    first.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP boolean config blocks prompt while changing and rejects a late reply after removal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-boolean-"));
  let release: (() => void) | undefined;
  let calls = 0;
  const service = createAcpService({
    directory: dir,
    connect: async () => ({
      sessionId: "native-id",
      configOptions: [{ id: "fast", name: "Fast", type: "boolean", currentValue: false }],
      modeState: null,
      async setConfigOption(_id, value) {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [{ id: "fast", name: "Fast", type: "boolean", currentValue: value as boolean }];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "claude" });
    await assert.rejects(
      service.setConfigOption({ ...workspace, id: session.id, configId: "fast", value: "true" }),
      /not available/,
    );
    assert.equal(calls, 0);
    const changing = service.setConfigOption({
      ...workspace,
      id: session.id,
      configId: "fast",
      value: true,
    });
    await waitFor(() => release);
    await assert.rejects(
      service.prompt({ ...workspace, id: session.id, commandId: "one", text: "go" }),
      /running/,
    );
    assert.equal(
      (await service.read({ ...workspace, id: session.id })).configOptions[0]?.currentValue,
      false,
    );
    await service.remove({ ...workspace, id: session.id });
    release?.();
    await assert.rejects(changing, /changed while configuring/);
    await assert.rejects(service.read({ ...workspace, id: session.id }));
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP early config notification survives the session/new response projection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-early-config-"));
  const service = createAcpService({
    directory: dir,
    connect: async ({ onUpdate }) => {
      await onUpdate({
        kind: "config",
        configOptions: [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "new",
            options: [{ value: "new", name: "New" }],
          },
        ],
      });
      return {
        sessionId: "native-id",
        configOptions: [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "old",
            options: [{ value: "old", name: "Old" }],
          },
        ],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {},
        async cancel() {},
        close() {},
      };
    },
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    assert.equal(session.configOptions[0]?.currentValue, "new");
    assert.equal(
      (await service.read({ ...workspace, id: session.id })).configOptions[0]?.currentValue,
      "new",
    );
  } finally {
    service.disposeAll();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACP missing image capability rejects before admission and permits retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-reject-"));
  let turns = 0;
  const factory: AcpConnectionFactory = async () => ({
    sessionId: "native-id",
    async prompt() {
      turns += 1;
    },
    async cancel() {},
    close() {},
  });
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    const session = await service.create({ ...workspace, agent: "claude" });
    await assert.rejects(
      service.prompt({
        ...workspace,
        id: session.id,
        commandId: "one",
        text: "see",
        attachments: [{ fileName: "pixel.png", mimeType: "image/png", dataBase64: "cG5n" }],
      }),
      /does not accept images/,
    );
    assert.equal((await service.read({ ...workspace, id: session.id })).entries.length, 0);
    await service.prompt({ ...workspace, id: session.id, commandId: "one", text: "see" });
    assert.equal(turns, 1);
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Codex and Claude ACP stay isolated from each other and from another workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-test-"));
  const seen: string[] = [];
  const factory: AcpConnectionFactory = async ({ agent, workspacePath, sessionId, onUpdate }) => {
    seen.push(`${agent}:${workspacePath}:${sessionId ?? "new"}`);
    return {
      sessionId: sessionId ?? `${agent}-native-id`,
      async prompt(text) {
        await onUpdate({ kind: "text", text: `reply: ${text}` });
      },
      async cancel() {},
      close() {},
    };
  };
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    const codex = await service.create({ ...workspace, agent: "codex" });
    const claude = await service.create({ ...workspace, agent: "claude" });
    await service.prompt({ ...workspace, id: codex.id, commandId: "command-1", text: "hello" });
    assert.deepEqual(seen, ["codex:/tmp/acp-example:new", "claude:/tmp/acp-example:new"]);
    assert.equal(
      (await service.read({ ...workspace, id: codex.id })).entries[1]?.kind,
      "assistant",
    );
    assert.equal((await service.read({ ...workspace, id: claude.id })).entries.length, 0);
    await assert.rejects(service.read({ workspacePath: "/tmp/other", id: codex.id }));
    assert.deepEqual(
      (await service.list({ workspacePath: "/tmp/other" })).map((s) => s.id),
      [],
    );
    const restarted = createAcpService({ directory: dir, connect: factory });
    // 未使用的 Claude 空白会话留在磁盘，但重启后不再作为可恢复会话列出。
    assert.deepEqual(
      (await restarted.list(workspace)).map(({ id }) => id),
      [codex.id],
    );
    await restarted.prompt({ ...workspace, id: codex.id, commandId: "command-2", text: "again" });
    assert.equal(seen.at(-1), "codex:/tmp/acp-example:codex-native-id");
    assert.equal((await restarted.read({ ...workspace, id: codex.id })).entries.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("permission requires the matching choice; busy input queues and stop pauses it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-permission-"));
  let permission: string | null | undefined;
  let release: (() => void) | undefined;
  let cancelled = false;
  const factory: AcpConnectionFactory = async ({ onPermission }) => ({
    sessionId: "external-id",
    async prompt() {
      permission = await onPermission({
        requestId: "permission-1",
        title: "write file",
        options: [{ optionId: "accept", name: "Accept", kind: "allow_once" }],
      });
      await new Promise<void>((resolve) => (release = resolve));
    },
    async cancel() {
      cancelled = true;
      release?.();
    },
    close() {},
  });
  try {
    const service = createAcpService({ directory: dir, connect: factory });
    const session = await service.create({ ...workspace, agent: "codex" });
    const first = service.prompt({
      ...workspace,
      id: session.id,
      commandId: "first",
      text: "write",
    });
    await waitFor(
      async () => (await service.read({ ...workspace, id: session.id })).pendingPermission,
    );
    const queued = await service.prompt({
      ...workspace,
      id: session.id,
      commandId: "second",
      text: "again",
    });
    assert.equal(queued.queue.items[0]?.commandId, "second");
    await assert.rejects(
      service.decide({ ...workspace, id: session.id, requestId: "wrong", optionId: "accept" }),
    );
    await service.decide({
      ...workspace,
      id: session.id,
      requestId: "permission-1",
      optionId: "accept",
    });
    await waitFor(() => permission !== undefined);
    assert.equal(permission, "accept");
    await service.stop({ ...workspace, id: session.id });
    await first;
    assert.equal(cancelled, true);
    const ended: AcpSession = await service.read({ ...workspace, id: session.id });
    assert.equal(ended.status, "idle");
    assert.equal(ended.pendingPermission, null);
    assert.equal(ended.queue.autoDrain, false);
    assert.equal(ended.queue.items[0]?.commandId, "second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconnection changes attachment id without losing workspace history or leaking deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-reconnect-"));
  const connect: AcpConnectionFactory = async () => ({
    sessionId: "native-id",
    async prompt() {},
    async cancel() {},
    close() {},
  });
  try {
    const service = createAcpService({ directory: dir, connect });
    const initial = { ...workspace, remoteSessionId: "attachment-old" };
    const resumed = { ...workspace, remoteSessionId: "attachment-new" };
    const another = { workspacePath: "/tmp/acp-example", workspaceIdentity: "remote:ssh:other" };
    const session = await service.create({ ...initial, agent: "claude" });
    const removed: string[] = [];
    const subscription = service.onDynamicSessionChanged(resumed)((event) => {
      if (event.kind === "removed") removed.push(event.id);
    });
    const anotherSubscription = service.onDynamicSessionChanged(another)((event) => {
      if (event.kind === "removed") removed.push(`other:${event.id}`);
    });
    assert.deepEqual(
      (await service.list(resumed)).map((item) => item.id),
      [session.id],
    );
    await service.prompt({
      ...resumed,
      id: session.id,
      commandId: "new-attachment",
      text: "hello",
    });
    await service.remove({ ...resumed, id: session.id });
    assert.deepEqual(removed, [session.id]);
    assert.deepEqual(await service.list(initial), []);
    subscription.dispose();
    anotherSubscription.dispose();
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop cancels permission, closes the old process, and ignores late updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-stop-"));
  let lateUpdate: ((update: { kind: "text"; text: string }) => Promise<void>) | undefined;
  let choice: string | null | undefined;
  let release: (() => void) | undefined;
  let closed = false;
  const connect: AcpConnectionFactory = async ({ onPermission, onUpdate }) => {
    lateUpdate = onUpdate;
    return {
      sessionId: "native-id",
      async prompt() {
        choice = await onPermission({
          requestId: "ask-1",
          title: "modify files",
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      async cancel() {
        release?.();
      },
      close() {
        closed = true;
      },
    };
  };
  try {
    const service = createAcpService({ directory: dir, connect });
    const session = await service.create({ ...workspace, agent: "codex" });
    const running = service.prompt({
      ...workspace,
      id: session.id,
      commandId: "one",
      text: "edit",
    });
    await waitFor(
      async () => (await service.read({ ...workspace, id: session.id })).pendingPermission,
    );
    await service.stop({ ...workspace, id: session.id });
    await running;
    assert.equal(choice, null);
    assert.equal(closed, true);
    await assert.rejects(
      service.decide({ ...workspace, id: session.id, requestId: "ask-1", optionId: "allow" }),
      /expired/,
    );
    await lateUpdate?.({ kind: "text", text: "stale reply" });
    const result = await service.read({ ...workspace, id: session.id });
    assert.equal(result.status, "idle");
    assert.equal(result.pendingPermission, null);
    assert.equal(result.entries.length, 1);
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop keeps admission closed until the old process has been cancelled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-acp-stop-admission-"));
  let releaseCancel: (() => void) | undefined;
  let releasePrompt: (() => void) | undefined;
  const connect: AcpConnectionFactory = async () => ({
    sessionId: "native-id",
    async prompt() {
      await new Promise<void>((resolve) => {
        releasePrompt = resolve;
      });
    },
    async cancel() {
      await new Promise<void>((resolve) => {
        releaseCancel = resolve;
      });
      releasePrompt?.();
    },
    close() {},
  });
  try {
    const service = createAcpService({ directory: dir, connect });
    const session = await service.create({ ...workspace, agent: "codex" });
    const running = service.prompt({
      ...workspace,
      id: session.id,
      commandId: "first",
      text: "work",
    });
    await waitFor(
      async () => (await service.read({ ...workspace, id: session.id })).status === "running",
    );
    const stopping = service.stop({ ...workspace, id: session.id });
    await waitFor(() => Boolean(releaseCancel));
    await assert.rejects(
      service.prompt({ ...workspace, id: session.id, commandId: "second", text: "work" }),
      /running/,
    );
    releaseCancel?.();
    await stopping;
    await running;
    service.disposeAll();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => unknown | Promise<unknown>): Promise<void> {
  for (let n = 0; n < 100; n += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for ACP update");
}
