import assert from "node:assert/strict";
import test from "node:test";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { projectAppUsageCharts } from "../src/settings/usage-stats/appUsageSources.js";
const snapshot = () =>
  appUsageSnapshotSchema.parse({
    range: "7d",
    timeZone: "Asia/Shanghai",
    generatedAt: 1,
    source: "agent-db",
    summary: {
      totalTokens: 100,
      inputTokens: 70,
      outputTokens: 30,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 1,
      totalTurns: 1,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 1,
      currentStreakDays: 1,
      longestSessionMs: 0,
      longestStreakDays: 1,
      peakDayTokens: 100,
      favoriteModel: null,
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
    models: [
      {
        modelId: "glm",
        totalTokens: 100,
        inputTokens: 70,
        outputTokens: 30,
        requestCount: 1,
        share: 1,
      },
    ],
    dailyModelUsage: [{ date: "2026-10-08", models: [{ modelId: "glm", totalTokens: 100 }] }],
    tools: [],
    acpAgents: [
      {
        agent: "codex",
        sessions: 1,
        turns: 1,
        measuredTurns: 1,
        unknownTurns: 0,
        totalTokens: 200,
        inputTokens: 150,
        outputTokens: 50,
        models: [{ modelId: "gpt-codex", totalTokens: 200, inputTokens: 150, outputTokens: 50 }],
        dailyUsage: [{ date: "2026-10-08", models: [{ modelId: "gpt-codex", totalTokens: 200 }] }],
      },
    ],
  });
test("all charts include Codex actual model while API and ACP sources stay isolated", () => {
  const value = snapshot();
  const all = projectAppUsageCharts(value, "all");
  assert.equal(all.summary.totalTokens, 300);
  assert.equal(all.models.find((m) => m.modelId === "Codex ACP · gpt-codex")?.totalTokens, 200);
  assert.equal(all.dailyModelUsage[0]?.models.length, 2);
  assert.deepEqual(projectAppUsageCharts(value, "native"), value);
  const codex = projectAppUsageCharts(value, "acp:codex");
  assert.equal(codex.summary.totalTokens, 200);
  assert.equal(codex.models.length, 1);
  assert.equal(codex.models[0]?.share, 1);
  assert.equal(codex.models[0]?.modelId, "Codex ACP · gpt-codex");
  assert.equal(value.summary.totalTokens, 100);
});
test("model coverage gap is charted as unknown under its Agent, never assigned to GLM", () => {
  const value = snapshot();
  value.acpAgents![0]!.models = [];
  const result = projectAppUsageCharts(value, "all");
  assert.equal(result.models.find((m) => m.modelId === "glm")?.totalTokens, 100);
  assert.equal(result.models.find((m) => m.modelId === "Codex ACP · ?")?.totalTokens, 200);
});
