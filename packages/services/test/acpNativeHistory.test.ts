import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCodexUsageHistories } from "../src/acp/acpNativeUsage.js";
import { summarizeAcpUsage } from "../src/acp/acpUsageStats.js";
import { acpSessionSchema } from "@zcode/shared";
const id = "019c7714-3b77-74d1-9866-e1f484aae2ab";
const now = Date.parse("2026-10-08T12:00:00Z");
const old = "2026-09-01T12:00:00Z";
const recent = "2026-10-08T10:00:00Z";
const row = (type: string, payload: unknown, timestamp?: string) => ({ type, payload, timestamp });
const token = (input: number, output: number, timestamp?: string) =>
  row(
    "event_msg",
    {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          output_tokens: output,
          total_tokens: input + output,
          cached_input_tokens: input / 2,
        },
      },
    },
    timestamp,
  );
const start = (time: string, model?: string) => [
  row("event_msg", { type: "task_started" }, time),
  row("turn_context", { model }, time),
];
const done = (time: string) => row("event_msg", { type: "task_complete" }, time);
const session = (cwd: string) =>
  acpSessionSchema.parse({
    id: crypto.randomUUID(),
    agent: "codex",
    workspacePath: cwd,
    acpSessionId: id,
    title: "history",
    revision: 0,
    status: "idle",
    pendingPermission: null,
    error: null,
    entries: [
      { id: "user:old", kind: "user", text: "old", createdAt: Date.parse(old) - 100 },
      { id: "user:new", kind: "user", text: "new", createdAt: Date.parse(recent) - 100 },
    ],
  });
async function fixture(run: (root: string, cwd: string, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "acp-native-history-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  await mkdir(join(root, "sessions"));
  const file = join(root, "sessions", `rollout-${id}.jsonl`);
  try {
    await run(root, cwd, file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const jsonl = (cwd: string, ...rows: unknown[]) =>
  [row("session_meta", { id, cwd }), ...rows].map((v) => JSON.stringify(v)).join("\n") + "\n";

test("native history restores dated actual models and deduplicates requests and repeated Host references", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(
      file,
      jsonl(
        cwd,
        ...start(old, "gpt-old"),
        token(100, 20, old),
        done(old),
        ...start(recent, "gpt-codex"),
        token(140, 30, recent),
        token(140, 30, recent),
        token(180, 40, recent),
        done(recent),
      ),
    );
    const value = session(cwd);
    value.usageTurns = [
      { commandId: "new", totalTokens: 999, inputTokens: 900, outputTokens: 99, models: [] },
    ];
    const histories = await readCodexUsageHistories([value], root);
    const [all] = summarizeAcpUsage(
      [value, { ...value, id: crypto.randomUUID() }],
      { range: "all", timeZone: "Asia/Shanghai" },
      now,
      histories,
    );
    assert.equal(all?.totalTokens, 220);
    assert.equal(all?.measuredTurns, 2);
    assert.deepEqual(
      all?.models.map((m) => [m.modelId, m.totalTokens]),
      [
        ["gpt-old", 120],
        ["gpt-codex", 100],
      ],
    );
    const [week] = summarizeAcpUsage(
      [value],
      { range: "7d", timeZone: "Asia/Shanghai" },
      now,
      histories,
    );
    assert.equal(week?.totalTokens, 100);
    assert.equal(week?.unknownTurns, 0);
    assert.equal(week?.dailyUsage?.[0]?.date, "2026-10-08");
    assert.equal(week?.dailyUsage?.[0]?.models[0]?.modelId, "gpt-codex");
  }));
test("reset segments, missing model/date and incomplete turns do not fabricate model or full-turn coverage", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(
      file,
      jsonl(
        cwd,
        ...start(recent),
        token(100, 20, recent),
        token(10, 2, recent),
        token(20, 4),
        token(30, 6, recent),
      ),
    );
    const value = session(cwd);
    const histories = await readCodexUsageHistories([value], root);
    const [all] = summarizeAcpUsage(
      [value],
      { range: "all", timeZone: "Asia/Shanghai" },
      now,
      histories,
    );
    assert.equal(all?.totalTokens, 144);
    assert.deepEqual(all?.models, []);
    assert.equal(all?.measuredTurns, 0);
    const [week] = summarizeAcpUsage(
      [value],
      { range: "7d", timeZone: "Asia/Shanghai" },
      now,
      histories,
    );
    assert.equal(week?.totalTokens, 132);
    assert.equal(week?.dailyUsage?.[0]?.models[0]?.modelId, null);
  }));
test("invalid log metadata cannot replace verified ACP turn facts", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(file, jsonl(root, token(100, 20, recent)));
    const value = session(cwd);
    value.usageTurns = [
      { commandId: "new", totalTokens: 12, inputTokens: 10, outputTokens: 2, models: [] },
    ];
    const histories = await readCodexUsageHistories([value], root);
    assert.equal(
      summarizeAcpUsage([value], { range: "7d", timeZone: "Asia/Shanghai" }, now, histories)[0]
        ?.totalTokens,
      12,
    );
  }));

test("statistics restores saved disconnected history repeatedly without Agent launch or snapshot mutation", async () =>
  fixture(async (root, cwd, file) => {
    const { createAcpService } = await import("../src/acp/acpServiceImpl.js");
    const { createAcpAgentManager } = await import("../src/acp/acpAgentManager.js");
    const directory = join(root, "host");
    await mkdir(directory);
    const value = session(cwd);
    await writeFile(join(directory, `${value.id}.json`), JSON.stringify(value));
    await writeFile(
      file,
      jsonl(cwd, ...start(recent, "gpt-codex"), token(100, 20, recent), done(recent)),
    );
    const manager = createAcpAgentManager({
      directory: join(root, "settings"),
      env: { CODEX_HOME: root },
    });
    const service = createAcpService({
      directory,
      agentManager: manager,
      connect: async () => {
        throw Error("statistics must not launch an Agent");
      },
    });
    try {
      for (let i = 0; i < 2; i++) {
        const result = await service.getUsageStats({ range: "all", timeZone: "Asia/Shanghai" });
        assert.equal(result[0]?.totalTokens, 120);
        assert.equal(result[0]?.models[0]?.modelId, "gpt-codex");
      }
      assert.equal((await service.read({ ...value, id: value.id })).revision, value.revision);
      await service.remove({ ...value, id: value.id });
      assert.deepEqual(
        await service.getUsageStats({ range: "all", timeZone: "Asia/Shanghai" }),
        [],
      );
    } finally {
      service.disposeAll();
      manager.dispose();
    }
  }));

test("deletion and Host disposal during native history IO cannot resurrect usage", async () =>
  fixture(async (root, cwd, file) => {
    const { createAcpService } = await import("../src/acp/acpServiceImpl.js");
    const { createAcpAgentManager } = await import("../src/acp/acpAgentManager.js");
    await writeFile(
      file,
      jsonl(cwd, ...start(recent, "gpt-codex"), token(100, 20, recent), done(recent)),
    );
    for (const action of ["delete", "dispose"] as const) {
      const directory = join(root, action);
      await mkdir(directory);
      const value = session(cwd);
      await writeFile(join(directory, `${value.id}.json`), JSON.stringify(value));
      const ready = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<string>();
      const manager = createAcpAgentManager({
        directory: join(root, "settings"),
        env: { CODEX_HOME: root },
      });
      manager.resolveCodexHome = () => {
        ready.resolve();
        return finish.promise;
      };
      const service = createAcpService({
        directory,
        agentManager: manager,
        connect: async () => {
          throw Error("no process");
        },
      });
      try {
        const running = service.getUsageStats({ range: "all", timeZone: "Asia/Shanghai" });
        await ready.promise;
        if (action === "delete") await service.remove({ ...value, id: value.id });
        else service.disposeAll();
        finish.resolve(root);
        if (action === "delete") assert.deepEqual(await running, []);
        else await assert.rejects(running, /closed/);
      } finally {
        finish.resolve(root);
        service.disposeAll();
        manager.dispose();
      }
    }
  }));

test("cross-midnight requests follow query timezone and deleted worktrees preserve exact path history", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(
      file,
      jsonl(
        cwd,
        ...start("2026-10-07T15:59:00Z", "gpt-first"),
        token(100, 20, "2026-10-07T15:59:00Z"),
        row("turn_context", { model: "gpt-second" }, "2026-10-07T16:01:00Z"),
        token(200, 40, "2026-10-07T16:01:00Z"),
        done("2026-10-07T16:02:00Z"),
      ),
    );
    const value = session(cwd);
    await rm(cwd, { recursive: true });
    const histories = await readCodexUsageHistories([value], root);
    const [shanghai] = summarizeAcpUsage(
      [value],
      { range: "7d", timeZone: "Asia/Shanghai" },
      now,
      histories,
    );
    assert.deepEqual(
      shanghai?.dailyUsage?.map((day) => [
        day.date,
        day.models[0]?.modelId,
        day.models[0]?.totalTokens,
      ]),
      [
        ["2026-10-07", "gpt-first", 120],
        ["2026-10-08", "gpt-second", 120],
      ],
    );
    const [utc] = summarizeAcpUsage([value], { range: "7d", timeZone: "UTC" }, now, histories);
    assert.equal(utc?.dailyUsage?.length, 1);
  }));
