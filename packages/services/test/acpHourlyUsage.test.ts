import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema } from "@zcode/shared";
import { summarizeAcpUsage } from "../src/acp/acpUsageStats.js";
import { codexUsageKey, type CodexUsageHistory } from "../src/acp/acpNativeUsage.js";

const until = Date.parse("2026-10-13T12:00Z");
const timestamp = Date.parse("2026-10-13T01:30Z");
const usage = { totalTokens: 100, inputTokens: 70, outputTokens: 30 };
function session(agent: "claude" | "codex") {
  return acpSessionSchema.parse({
    id: "fixture",
    agent,
    acpSessionId: "native",
    workspacePath: "/fixture",
    title: "fixture",
    revision: 0,
    status: "idle",
    pendingPermission: null,
    error: null,
    entries: [{ kind: "user", id: "user:one", text: "fixture", createdAt: timestamp }],
    usageTurns: [{ commandId: "one", ...usage, models: [] }],
  });
}

test("ACP whole-turn hourly facts retain unknown model and never allocate undated usage", () => {
  const value = session("claude");
  const before = structuredClone(value);
  for (const range of ["all", "7d", "30d"] as const) {
    const [group] = summarizeAcpUsage([value], { range, timeZone: "Asia/Shanghai" }, until);
    assert.equal(group?.hourlyUsage?.date, "2026-10-13");
    assert.deepEqual(group?.hourlyUsage?.hours[9]?.models, [{ modelId: null, totalTokens: 100 }]);
  }
  assert.deepEqual(value, before);
  delete value.entries[0]!.createdAt;
  const [undated] = summarizeAcpUsage([value], { range: "all", timeZone: "UTC" }, until);
  assert.equal(undated?.totalTokens, 100);
  assert.ok(undated?.hourlyUsage?.hours.every((hour) => hour.models.length === 0));
});

test("Codex native hourly records replace turn facts, deduplicate sessions and exclude other days", () => {
  const value = session("codex");
  const history: CodexUsageHistory = {
    nativeSessionId: "native",
    usage,
    turns: [],
    records: [
      { timestamp, modelId: "actual-model", usage },
      { timestamp: Date.parse("2026-10-12T01:30Z"), modelId: "old", usage },
      { timestamp: until + 1, modelId: "future", usage },
    ],
  };
  const [group] = summarizeAcpUsage(
    [value, { ...value, id: "duplicate" }],
    { range: "7d", timeZone: "UTC" },
    until,
    new Map([[codexUsageKey(value), history]]),
  );
  assert.equal(group?.totalTokens, 200);
  assert.deepEqual(group?.hourlyUsage?.hours[1]?.models, [
    { modelId: "actual-model", totalTokens: 100 },
  ]);
  assert.equal(group?.hourlyUsage?.hours.flatMap((hour) => hour.models).length, 1);
});
