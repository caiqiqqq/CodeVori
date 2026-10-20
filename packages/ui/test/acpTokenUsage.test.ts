import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema } from "@zcode/shared";
import { projectAcpTokenUsage } from "../src/v4/acpTokenUsage.js";
const session = () =>
  acpSessionSchema.parse({
    id: crypto.randomUUID(),
    workspacePath: "/fixture",
    agent: "codex",
    acpSessionId: "native",
    status: "idle",
    revision: 1,
    title: "fixture",
    entries: [],
    pendingPermission: null,
    error: null,
  });
const usage = { totalTokens: 12, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 };
test("native snapshot wins without double counting, wrong native ID falls back to measured turns", () => {
  const value = session();
  value.usageTurns = [{ commandId: "one", ...usage, models: [] }];
  value.nativeUsage = {
    nativeSessionId: "native",
    usage: { ...usage, totalTokens: 120, inputTokens: 100, outputTokens: 20 },
  };
  assert.deepEqual(projectAcpTokenUsage(value), {
    source: "native",
    usage: value.nativeUsage.usage,
  });
  value.nativeUsage.nativeSessionId = "other";
  assert.deepEqual(projectAcpTokenUsage(value), { source: "turns", measuredTurns: 1, usage });
});
test("old snapshots and missing cache dimensions remain unknown, confirmed zero is retained", () => {
  const value = session();
  assert.deepEqual(projectAcpTokenUsage(value), { source: "turns", measuredTurns: 0, usage: null });
  value.usageTurns = [
    { commandId: "one", ...usage, models: [] },
    { commandId: "two", totalTokens: 6, inputTokens: 4, outputTokens: 2, models: [] },
  ];
  assert.deepEqual(projectAcpTokenUsage(value)?.usage, {
    totalTokens: 18,
    inputTokens: 14,
    outputTokens: 4,
  });
  value.usageTurns.pop();
  assert.equal(projectAcpTokenUsage(value)?.usage?.cacheReadTokens, 0);
  assert.equal(projectAcpTokenUsage(null), null);
});
