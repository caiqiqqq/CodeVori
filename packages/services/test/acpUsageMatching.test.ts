import assert from "node:assert/strict";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { summarizeAcpUsage } from "../src/acp/acpUsageStats.js";
import { codexUsageKey, type CodexUsageHistory } from "../src/acp/acpNativeUsage.js";

const until = Date.UTC(2026, 9, 22);
function fixture(times: Array<number | undefined>, turns: CodexUsageHistory["turns"]) {
  const session = {
    agent: "codex",
    acpSessionId: "native",
    workspacePath: "/fixture",
    usageTurns: [],
    entries: times.map((createdAt, i) => ({ kind: "user", id: `user:${i}`, text: "", createdAt })),
  } as unknown as AcpSession;
  const history: CodexUsageHistory = {
    nativeSessionId: "native",
    usage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 },
    records: [],
    turns,
  };
  return { session, histories: new Map([[codexUsageKey(session), history]]) };
}

test("indexed native matching preserves missing, unordered, repeated and future boundaries", () => {
  const start = until - 10000;
  const times = [
    until - 31 * 86_400_000,
    undefined,
    start,
    start + 10,
    undefined,
    start + 30,
    start + 20,
    start + 40,
    until + 1,
  ];
  const turns = [
    null,
    start - 1,
    start,
    start + 10,
    start + 15,
    start + 20,
    start + 30,
    start + 40,
    until + 1,
  ]
    .map((startedAt, i) => ({
      startedAt,
      finishedAt: i === 7 ? until + 1 : i === 1 ? null : start + 50,
      complete: i !== 4,
      measured: i !== 5,
    }))
    .reverse();
  const { session, histories } = fixture(times, turns);
  session.entries.splice(5, 0, { ...session.entries[2]! });
  const before = structuredClone({ session, histories });
  for (const range of ["all", "7d", "30d"] as const) {
    // 以既有区间定义作为独立参考，包含右边界排除和重复 command 去重。
    const seen = new Set<string>();
    let count = 0,
      measured = 0;
    const since = range === "all" ? 0 : until - (range === "7d" ? 7 : 30) * 86_400_000;
    for (const [index, entry] of session.entries.entries()) {
      if (
        seen.has(entry.id) ||
        (entry.createdAt === undefined
          ? range !== "all"
          : entry.createdAt > until || entry.createdAt < since)
      )
        continue;
      seen.add(entry.id);
      count++;
      const next =
        session.entries.slice(index + 1).find((item) => item.createdAt !== undefined)?.createdAt ??
        Infinity;
      const matching =
        entry.createdAt === undefined
          ? []
          : turns.filter(
              (turn) =>
                turn.startedAt !== null &&
                turn.startedAt >= entry.createdAt! &&
                turn.startedAt < next &&
                turn.startedAt <= until,
            );
      if (
        matching.length &&
        matching.every(
          (turn) =>
            turn.complete && turn.measured && turn.finishedAt !== null && turn.finishedAt <= until,
        )
      )
        measured++;
    }
    const [actual] = summarizeAcpUsage([session], { range, timeZone: "UTC" }, until, histories);
    assert.deepEqual(
      [actual?.turns, actual?.measuredTurns, actual?.unknownTurns],
      [count, measured, count - measured],
    );
  }
  assert.deepEqual({ session, histories }, before);
});

test("long histories do not scan every native turn for each user message", () => {
  const n = 2000;
  let reads = 0;
  const times = Array.from({ length: n }, (_, i) => until - n + i);
  const turns = times.map((time) => ({
    get startedAt() {
      reads++;
      return time;
    },
    finishedAt: time,
    complete: true,
    measured: true,
  }));
  const { session, histories } = fixture(times, turns);
  const [actual] = summarizeAcpUsage(
    [session],
    { range: "all", timeZone: "UTC" },
    until,
    histories,
  );
  assert.equal(actual?.measuredTurns, n);
  assert.ok(reads < n * 60, `native timestamp reads must stay bounded, received ${reads}`);
});
