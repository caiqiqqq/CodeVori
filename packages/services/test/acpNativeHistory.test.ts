import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  appendFile,
  mkdtemp,
  mkdir,
  rename,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCodexUsageHistoryReader,
  readCodexUsageHistories,
} from "../src/acp/acpNativeUsage.js";
import { summarizeAcpUsage } from "../src/acp/acpUsageStats.js";
import { acpSessionSchema } from "@zcode/shared";
import { codexUsageKey } from "../src/acp/acpNativeUsage.js";
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

test("Host reader reuses unchanged history across ranges and reparses appended complete lines", async () =>
  fixture(async (root, cwd, file) => {
    const reader = createCodexUsageHistoryReader();
    const value = session(cwd);
    const key = codexUsageKey(value);
    await writeFile(file, jsonl(cwd, ...start(old, "gpt-old"), token(100, 20, old), done(old)));
    const first = (await reader.read([value], root)).get(key)!;
    const second = await reader.read([value], root);
    assert.strictEqual(second.get(key), first, "unchanged logs must skip parsing");
    assert.equal(
      summarizeAcpUsage([value], { range: "all", timeZone: "UTC" }, now, second)[0]?.totalTokens,
      120,
    );
    assert.equal(
      summarizeAcpUsage([value], { range: "7d", timeZone: "UTC" }, now, second).length,
      1,
    );
    assert.equal(
      summarizeAcpUsage([value], { range: "7d", timeZone: "UTC" }, now, second)[0]?.totalTokens,
      0,
    );
    const next = JSON.stringify(token(140, 30, recent));
    await appendFile(file, next.slice(0, -1));
    assert.equal((await reader.read([value], root)).get(key)?.usage.totalTokens, 120);
    await appendFile(file, "}\n");
    const updated = (await reader.read([value], root)).get(key)!;
    assert.notStrictEqual(updated, first);
    assert.equal(updated.usage.totalTokens, 170);
    assert.equal(
      updated.records.reduce((sum, item) => sum + item.usage.totalTokens, 0),
      170,
    );
    reader.dispose();
    assert.equal((await reader.read([value], root)).size, 0);
  }));

test("Host reader rejects stale cache after replacement, corruption, duplicate IDs and deletion", async () =>
  fixture(async (root, cwd, file) => {
    const reader = createCodexUsageHistoryReader();
    const value = session(cwd);
    const key = codexUsageKey(value);
    const original = jsonl(cwd, token(100, 20, recent));
    await writeFile(file, original);
    await reader.read([value], root);
    const before = await stat(file);
    await writeFile(file, jsonl(cwd, token(200, 40, recent)));
    await utimes(file, before.atime, before.mtime);
    assert.equal((await reader.read([value], root)).get(key)?.usage.totalTokens, 240);
    const replacement = join(root, "replacement.jsonl");
    await writeFile(replacement, original);
    await utimes(replacement, before.atime, before.mtime);
    await rename(replacement, file);
    assert.equal((await reader.read([value], root)).get(key)?.usage.totalTokens, 120);
    await writeFile(file, "invalid\n");
    assert.equal((await reader.read([value], root)).size, 0);
    await writeFile(file, original);
    assert.equal((await reader.read([value], root)).size, 1);
    const duplicate = join(root, "sessions", `duplicate-${id}.jsonl`);
    await writeFile(duplicate, original);
    assert.equal((await reader.read([value], root)).size, 0);
    await rm(duplicate);
    assert.equal((await reader.read([value], root)).size, 1);
    await rm(file);
    assert.equal((await reader.read([value], root)).size, 0);
  }));

test("Host caches isolate roots, readers, registered sessions and canonical workspace changes", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(file, jsonl(cwd, token(100, 20, recent)));
    const value = session(cwd);
    const key = codexUsageKey(value);
    const reader = createCodexUsageHistoryReader();
    const first = (await reader.read([value], root)).get(key);
    assert.notStrictEqual(
      (await createCodexUsageHistoryReader().read([value], root)).get(key),
      first,
    );
    await reader.read([], root);
    assert.notStrictEqual((await reader.read([value], root)).get(key), first);
    const other = join(root, "other-home");
    await mkdir(join(other, "sessions"), { recursive: true });
    await writeFile(
      join(other, "sessions", `rollout-${id}.jsonl`),
      jsonl(cwd, token(200, 40, recent)),
    );
    assert.equal((await reader.read([value], other)).get(key)?.usage.totalTokens, 240);
    assert.equal((await reader.read([value], root)).get(key)?.usage.totalTokens, 120);
    const alias = join(root, "alias");
    await symlink(cwd, alias, "dir");
    const linked = { ...value, workspacePath: alias };
    assert.equal((await reader.read([linked], root)).size, 1);
    await rm(alias);
    await symlink(other, alias, "dir");
    assert.equal((await reader.read([linked], root)).size, 0);
  }));

test("Host cache retains more than 128 histories and evicts only beyond its file budget", async () =>
  fixture(async (root, cwd) => {
    const values = Array.from({ length: 1025 }, () => ({
      ...session(cwd),
      acpSessionId: crypto.randomUUID(),
    }));
    await Promise.all(
      values.map((value) =>
        writeFile(
          join(root, "sessions", `rollout-${value.acpSessionId}.jsonl`),
          [row("session_meta", { id: value.acpSessionId, cwd }), token(100, 20, recent)]
            .map((v) => JSON.stringify(v))
            .join("\n") + "\n",
        ),
      ),
    );
    const reader = createCodexUsageHistoryReader();
    const retained = await reader.read(values.slice(0, 216), root);
    const repeated = await reader.read(values.slice(0, 216), root);
    assert.strictEqual(
      repeated.get(codexUsageKey(values[0]!)),
      retained.get(codexUsageKey(values[0]!)),
    );
    const first = await reader.read(values, root);
    assert.equal(first.size, 1025);
    const again = await reader.read([values[0]!], root);
    assert.notStrictEqual(
      again.get(codexUsageKey(values[0]!)),
      first.get(codexUsageKey(values[0]!)),
    );
    assert.equal(again.get(codexUsageKey(values[0]!))?.usage.totalTokens, 120);
  }));

test("restart reuses validated numeric checkpoint without opening unchanged native logs", async (t) =>
  fixture(async (root, cwd, file) => {
    const cacheFile = join(root, "host-cache", "codex-history.json");
    const value = session(cwd);
    const key = codexUsageKey(value);
    await writeFile(
      file,
      jsonl(cwd, ...start(recent, "gpt-codex"), token(100, 20, recent), done(recent)),
    );
    const open = t.mock.method(fs, "createReadStream");
    syncBuiltinESMExports();
    t.after(() => {
      open.mock.restore();
      syncBuiltinESMExports();
    });
    const read = async () => {
      const reader = createCodexUsageHistoryReader(cacheFile);
      try {
        return await reader.read([value], root);
      } finally {
        reader.dispose();
      }
    };
    const first = await read();
    assert.equal(open.mock.callCount(), 1);
    assert.deepEqual(await read(), first);
    assert.equal(open.mock.callCount(), 1, "restart must not reparse unchanged JSONL");
    const stored = await readFile(cacheFile, "utf8");
    assert.ok(!stored.includes('"session_meta"'));
    await appendFile(file, JSON.stringify(token(200, 40, recent)) + "\n");
    assert.equal((await read()).get(key)?.usage.totalTokens, 240);
    assert.equal(open.mock.callCount(), 2);
    const before = await stat(file);
    await writeFile(file, jsonl(cwd, token(300, 60, recent)));
    await utimes(file, before.atime, before.mtime);
    assert.equal((await read()).get(key)?.usage.totalTokens, 360);
    assert.equal(open.mock.callCount(), 3);
    const replacement = join(root, "replacement.jsonl");
    await writeFile(replacement, jsonl(cwd, token(400, 80, recent)));
    await rename(replacement, file);
    assert.equal((await read()).get(key)?.usage.totalTokens, 480);
    assert.equal(open.mock.callCount(), 4);
    await writeFile(
      join(root, "sessions", `duplicate-${id}.jsonl`),
      jsonl(cwd, token(900, 90, recent)),
    );
    assert.equal((await read()).size, 0);
    assert.equal(open.mock.callCount(), 4);
    await rm(join(root, "sessions", `duplicate-${id}.jsonl`));
    assert.equal((await read()).size, 1);
    await rm(file);
    assert.equal((await read()).size, 0);
  }));

test("restart validates root, file, workspace and native ID before trusting a checkpoint", async () =>
  fixture(async (root, cwd, file) => {
    const cacheFile = join(root, "cache.json");
    const value = session(cwd);
    const read = async () => {
      const reader = createCodexUsageHistoryReader(cacheFile);
      try {
        return await reader.read([value], root);
      } finally {
        reader.dispose();
      }
    };
    await writeFile(file, jsonl(cwd, token(100, 20, recent)));
    await read();
    const original = JSON.parse(await readFile(cacheFile, "utf8"));
    for (const field of ["root", "file", "workspace", "nativeSessionId"]) {
      const checkpoint = structuredClone(original);
      const entry = checkpoint.entries[0][1];
      // 故意污染旧投影；身份不匹配时必须重读原始日志，不能显示 999。
      entry.history.usage.totalTokens = 999;
      if (field === "nativeSessionId") entry.history.nativeSessionId = crypto.randomUUID();
      else entry[field] = join(root, "different");
      await writeFile(cacheFile, JSON.stringify(checkpoint));
      assert.equal((await read()).get(codexUsageKey(value))?.usage.totalTokens, 120);
    }
    const alias = join(root, "alias");
    await symlink(cwd, alias, "dir");
    const reader = createCodexUsageHistoryReader(cacheFile);
    assert.equal((await reader.read([{ ...value, workspacePath: alias }], root)).size, 1);
    reader.dispose();
    await rm(alias);
    await symlink(root, alias, "dir");
    const restarted = createCodexUsageHistoryReader(cacheFile);
    assert.equal((await restarted.read([{ ...value, workspacePath: alias }], root)).size, 0);
    restarted.dispose();
  }));

test("invalid, incompatible and unwritable checkpoints fall back to native facts", async () =>
  fixture(async (root, cwd, file) => {
    const cacheFile = join(root, "cache.json");
    const value = session(cwd);
    await writeFile(file, jsonl(cwd, token(100, 20, recent)));
    for (const content of [
      "invalid",
      '{"version":999,"entries":[]}',
      '{"version":1,"entries":[{}]}',
    ]) {
      await writeFile(cacheFile, content);
      const reader = createCodexUsageHistoryReader(cacheFile);
      assert.equal(
        (await reader.read([value], root)).get(codexUsageKey(value))?.usage.totalTokens,
        120,
      );
      reader.dispose();
    }
    await truncate(cacheFile, 32 * 1024 * 1024 + 1);
    const oversized = createCodexUsageHistoryReader(cacheFile);
    assert.equal(
      (await oversized.read([value], root)).get(codexUsageKey(value))?.usage.totalTokens,
      120,
    );
    oversized.dispose();
    // 普通文件不能作为缓存父目录；写缓存失败也必须返回真实用量。
    const reader = createCodexUsageHistoryReader(join(file, "cache.json"));
    assert.equal(
      (await reader.read([value], root)).get(codexUsageKey(value))?.usage.totalTokens,
      120,
    );
    reader.dispose();
  }));

test("numeric cache budget bounds retained requests without truncating query results", async () =>
  fixture(async (root, cwd) => {
    const values = Array.from({ length: 3 }, () => ({
      ...session(cwd),
      acpSessionId: crypto.randomUUID(),
    }));
    const requests =
      Array.from({ length: 35_000 }, (_, index) =>
        JSON.stringify(token((index + 1) * 2, 0, recent)),
      ).join("\n") + "\n";
    await Promise.all(
      values.map((value) =>
        writeFile(
          join(root, "sessions", `rollout-${value.acpSessionId}.jsonl`),
          JSON.stringify(row("session_meta", { id: value.acpSessionId, cwd })) + "\n" + requests,
        ),
      ),
    );
    const reader = createCodexUsageHistoryReader();
    const first = await reader.read(values, root);
    assert.equal(first.size, 3);
    assert.equal(
      [...first.values()].reduce((sum, value) => sum + value.records.length, 0),
      105_000,
    );
    const again = await reader.read([values[0]!], root);
    assert.notStrictEqual(
      again.get(codexUsageKey(values[0]!)),
      first.get(codexUsageKey(values[0]!)),
    );
    assert.equal(again.get(codexUsageKey(values[0]!))?.usage.totalTokens, 70_000);
  }));

test("disposing a Host reader during IO prevents late results and cache publication", async () =>
  fixture(async (root, cwd, file) => {
    await writeFile(file, jsonl(cwd, token(100, 20, recent)));
    const cacheFile = join(root, "cache.json");
    const reader = createCodexUsageHistoryReader(cacheFile);
    const value = session(cwd);
    const pending = reader.read([value], root);
    reader.dispose();
    assert.equal((await pending).size, 0);
    assert.equal((await reader.read([value], root)).size, 0);
    await assert.rejects(readFile(cacheFile), { code: "ENOENT" });
    assert.equal((await createCodexUsageHistoryReader().read([value], root)).size, 1);
  }));

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

test("statistics restores saved disconnected history after Host restart without Agent launch or snapshot mutation", async (t) =>
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
    const options = {
      directory,
      agentManager: manager,
      connect: async () => {
        throw Error("statistics must not launch an Agent");
      },
    };
    let service = createAcpService(options);
    const open = t.mock.method(fs, "createReadStream");
    syncBuiltinESMExports();
    t.after(() => {
      open.mock.restore();
      syncBuiltinESMExports();
    });
    try {
      for (let i = 0; i < 2; i++) {
        const result = await service.getUsageStats({ range: "all", timeZone: "Asia/Shanghai" });
        assert.equal(result[0]?.totalTokens, 120);
        assert.equal(result[0]?.models[0]?.modelId, "gpt-codex");
      }
      assert.equal(open.mock.callCount(), 1);
      service.disposeAll();
      service = createAcpService(options);
      const restored = await service.getUsageStats({ range: "all", timeZone: "Asia/Shanghai" });
      assert.equal(restored[0]?.totalTokens, 120);
      assert.equal(open.mock.callCount(), 1, "Host restart must reuse the durable projection");
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
