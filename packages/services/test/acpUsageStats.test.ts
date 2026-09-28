import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpUsageReport } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { projectAcpPromptUsage } from "../src/acp/acpUsageResponse.js";

const workspace = { workspacePath: "/tmp/acp-usage", workspaceIdentity: "remote:usage:one" };
const request = { range: "all" as const, timeZone: "Asia/Shanghai" };

test("ACP session cumulative reports are counted once per accepted command and isolated by Agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-usage-"));
  const usageByAgent = {
    codex: [
      { totalTokens: 100, inputTokens: 70, outputTokens: 30 },
      { totalTokens: 160, inputTokens: 110, outputTokens: 50 },
      { totalTokens: 200, inputTokens: 140, outputTokens: 60 },
      { totalTokens: 250, inputTokens: 175, outputTokens: 75 },
    ],
    claude: [{ totalTokens: 40, inputTokens: 30, outputTokens: 10 }],
  };
  const calls = new Map<string, number>();
  const connect: AcpConnectionFactory = async ({ agent }) => ({
    sessionId: `${agent}-native`,
    configOptions: [],
    modeState: null,
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt() {
      const next = calls.get(agent) ?? 0;
      calls.set(agent, next + 1);
      const usage = usageByAgent[agent as "codex" | "claude"]?.[next];
      return usage ? { scope: "session", usage, models: [] } : null;
    },
    async cancel() {},
    close() {},
  });
  const service = createAcpService({ directory, connect });
  try {
    const codex = await service.create({ ...workspace, agent: "codex" });
    const claude = await service.create({ ...workspace, agent: "claude" });
    const first = { ...workspace, id: codex.id, commandId: "one", text: "hello" };
    await service.prompt(first);
    await service.prompt(first);
    await service.prompt({ ...workspace, id: codex.id, commandId: "two", text: "again" });
    await service.prompt({ ...workspace, id: claude.id, commandId: "three", text: "hello" });
    assert.equal(calls.get("codex"), 2);
    assert.deepEqual(
      (await service.getUsageStats(request)).map(({ agent, totalTokens, turns, unknownTurns }) => ({
        agent,
        totalTokens,
        turns,
        unknownTurns,
      })),
      [
        { agent: "claude", totalTokens: 40, turns: 1, unknownTurns: 0 },
        { agent: "codex", totalTokens: 160, turns: 2, unknownTurns: 0 },
      ],
    );
    await service.updateRow({
      ...workspace,
      id: codex.id,
      action: { kind: "archive", archived: true },
    });
    assert.equal(
      (await service.getUsageStats(request)).find((row) => row.agent === "codex")?.totalTokens,
      160,
    );
    service.disposeAll();
    const restarted = createAcpService({ directory, connect });
    try {
      assert.equal(
        (await restarted.getUsageStats(request)).find((row) => row.agent === "codex")?.totalTokens,
        160,
      );
      await restarted.prompt({
        ...workspace,
        id: codex.id,
        commandId: "after-restart",
        text: "resume",
      });
      await restarted.prompt({ ...workspace, id: codex.id, commandId: "next", text: "next" });
      const afterRestart = (await restarted.getUsageStats(request)).find(
        (row) => row.agent === "codex",
      );
      assert.equal(afterRestart?.totalTokens, 210);
      assert.equal(afterRestart?.unknownTurns, 1);
      await restarted.remove({ ...workspace, id: claude.id });
      assert.deepEqual(
        (await restarted.getUsageStats(request)).map((row) => row.agent),
        ["codex"],
      );
    } finally {
      restarted.disposeAll();
    }
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a stopped ACP turn stays unknown when its usage arrives late", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-usage-stop-"));
  const result = Promise.withResolvers<AcpUsageReport>();
  const started = Promise.withResolvers<void>();
  const connect: AcpConnectionFactory = async () => ({
    sessionId: "late-native",
    configOptions: [],
    modeState: null,
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt() {
      started.resolve();
      return result.promise;
    },
    async cancel() {},
    close() {},
  });
  const service = createAcpService({ directory, connect });
  try {
    const session = await service.create({ ...workspace, agent: "claude" });
    const input = { ...workspace, id: session.id };
    const running = service.prompt({ ...input, commandId: "stopped", text: "hello" });
    await started.promise;
    await service.stop(input);
    result.resolve({
      scope: "turn",
      usage: { totalTokens: 42, inputTokens: 32, outputTokens: 10 },
      models: [],
    });
    await running;
    const [stats] = await service.getUsageStats(request);
    assert.equal(stats?.totalTokens, 0);
    assert.equal(stats?.turns, 1);
    assert.equal(stats?.unknownTurns, 1);
    assert.equal(stats?.measuredTurns, 0);
    assert.equal((await service.read(input)).usageTurns.length, 0);
    await service.remove(input);
    assert.deepEqual(await service.getUsageStats(request), []);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing reports, legacy baselines and reset counters do not invent turn usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-usage-legacy-"));
  const id = crypto.randomUUID();
  await writeFile(
    join(directory, `${id}.json`),
    JSON.stringify({
      ...workspace,
      id,
      agent: "codex",
      acpSessionId: "old-native",
      status: "idle",
      revision: 1,
      title: "History",
      entries: [{ id: "user:old", kind: "user", text: "old" }],
      pendingPermission: null,
      error: null,
    }),
  );
  const reports = [
    { totalTokens: 500, inputTokens: 300, outputTokens: 200 },
    { totalTokens: 550, inputTokens: 320, outputTokens: 230 },
    null,
    { totalTokens: 600, inputTokens: 350, outputTokens: 250 },
    { totalTokens: 20, inputTokens: 12, outputTokens: 8 },
    { totalTokens: 50, inputTokens: 30, outputTokens: 20 },
  ];
  const connect: AcpConnectionFactory = async () => ({
    sessionId: "old-native",
    configOptions: [],
    modeState: null,
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt() {
      const usage = reports.shift();
      return usage ? { scope: "session", usage, models: [] } : null;
    },
    async cancel() {},
    close() {},
  });
  const service = createAcpService({ directory, connect });
  try {
    for (const commandId of ["baseline", "measured", "missing", "resume", "reset", "after-reset"]) {
      await service.prompt({ ...workspace, id, commandId, text: commandId });
    }
    const [stats] = await service.getUsageStats(request);
    assert.equal(stats?.totalTokens, 80);
    assert.equal(stats?.turns, 7);
    assert.equal(stats?.measuredTurns, 2);
    assert.equal(stats?.unknownTurns, 5);
    assert.equal(stats?.sessions, 1);
    assert.equal((await service.getUsageStats({ ...request, range: "7d" }))[0]?.turns, 6);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified Claude usage includes cache and actual model facts, while Codex last-request usage stays unknown", () => {
  const response = {
    stopReason: "end_turn" as const,
    usage: {
      totalTokens: 20,
      inputTokens: 5,
      outputTokens: 3,
      cachedReadTokens: 10,
      cachedWriteTokens: 2,
    },
    _meta: {
      quota: {
        model_usage: [
          {
            model: "claude-sonnet",
            token_count: {
              totalTokens: 20,
              inputTokens: 5,
              outputTokens: 3,
              cachedInputTokens: 10,
              cachedWriteTokens: 2,
            },
          },
          {
            model: "claude-haiku",
            token_count: { totalTokens: 7, inputTokens: 2, outputTokens: 1, cachedInputTokens: 4 },
          },
        ],
      },
    },
  };
  assert.deepEqual(
    projectAcpPromptUsage("claude", { name: "@agentclientprotocol/claude-agent-acp" }, response),
    {
      scope: "turn",
      usage: { totalTokens: 27, inputTokens: 23, outputTokens: 4 },
      models: [
        { modelId: "claude-sonnet", totalTokens: 20, inputTokens: 17, outputTokens: 3 },
        { modelId: "claude-haiku", totalTokens: 7, inputTokens: 6, outputTokens: 1 },
      ],
    },
  );
  assert.equal(
    projectAcpPromptUsage("codex", { name: "@agentclientprotocol/codex-acp" }, response),
    null,
  );
  assert.equal(projectAcpPromptUsage("claude", { name: "unknown-adapter" }, response), null);
  assert.deepEqual(
    projectAcpPromptUsage(
      "claude",
      { name: "@agentclientprotocol/claude-agent-acp" },
      { ...response, _meta: {} },
    ),
    { scope: "turn", usage: { totalTokens: 20, inputTokens: 17, outputTokens: 3 }, models: [] },
  );
});
