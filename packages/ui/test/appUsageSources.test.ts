import assert from "node:assert/strict";
import test from "node:test";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { projectAppUsageCharts } from "../src/settings/usage-stats/appUsageSources.js";
import { projectAppUsageHeatmap } from "../src/settings/usage-stats/appUsageHeatmap.js";
const snapshot = () =>
  appUsageSnapshotSchema.parse({
    range: "7d",
    timeZone: "Asia/Shanghai",
    generatedAt: Date.UTC(2026, 9, 9, 8),
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

function activitySnapshot() {
  const value = snapshot();
  value.heatmap = {
    startDate: "2026-10-08",
    endDate: "2026-10-09",
    maxTokens: 100,
    weeks: [
      {
        weekIndex: 0,
        days: [
          { date: "2026-10-08", level: 4, totalTokens: 100, turnCount: 2, toolCallCount: 3 },
          { date: "2026-10-09", level: 0, totalTokens: 0, turnCount: 0, toolCallCount: 0 },
        ],
      },
    ],
  };
  return value;
}

test("activity projects dated API/ACP tokens independently and combines the same day without mutation", () => {
  const value = activitySnapshot();
  const before = structuredClone(value);
  const tokensOn = (source: string, date: string) =>
    projectAppUsageHeatmap(value, source)
      .weeks.flatMap((week) => week.days)
      .find((cell) => cell?.date === date);
  assert.equal(tokensOn("native", "2026-10-08")?.totalTokens, 100);
  assert.equal(tokensOn("native", "2026-10-08")?.turnCount, 2);
  assert.equal(tokensOn("acp:codex", "2026-10-08")?.totalTokens, 200);
  assert.equal(tokensOn("all", "2026-10-08")?.totalTokens, 300);
  assert.equal(tokensOn("acp:claude", "2026-10-08")?.totalTokens, 0);
  assert.deepEqual(value, before);
});

test("activity sums ACP models and recalculates intensity against the selected calendar", () => {
  const value = activitySnapshot();
  value.acpAgents![0]!.dailyUsage = [
    {
      date: "2026-10-08",
      models: [
        { modelId: "first", totalTokens: 40 },
        { modelId: "second", totalTokens: 10 },
      ],
    },
    { date: "2026-10-09", models: [{ modelId: "first", totalTokens: 200 }] },
    { date: "2020-01-01", models: [{ modelId: "old", totalTokens: 99999 }] },
  ];
  const activity = projectAppUsageHeatmap(value, "acp:codex");
  const cells = activity.weeks.flatMap((week) => week.days);
  assert.equal(activity.maxTokens, 200);
  assert.equal(cells.find((cell) => cell?.date === "2026-10-08")?.totalTokens, 50);
  assert.equal(cells.find((cell) => cell?.date === "2026-10-08")?.level, 1);
  assert.equal(cells.find((cell) => cell?.date === "2026-10-09")?.level, 4);
  assert.equal(
    cells.some((cell) => cell?.date === "2020-01-01"),
    false,
  );
  assert.equal(activity.weeks.length, 52);
  assert.equal(activity.weeks[0]!.days.length, 7);
  assert.equal(new Date(activity.startDate! + "T00:00:00Z").getUTCDay(), 0);
});

test("missing dated ACP usage retains an empty calendar and never assigns totals to today", () => {
  const value = activitySnapshot();
  value.acpAgents![0]!.dailyUsage = undefined;
  const activity = projectAppUsageHeatmap(value, "acp:codex");
  assert.equal(activity.weeks.length, 52);
  assert.equal(activity.maxTokens, 0);
  assert.equal(
    activity.weeks
      .flatMap((week) => week.days)
      .reduce((sum, cell) => sum + (cell?.totalTokens ?? 0), 0),
    0,
  );
  assert.equal(value.acpAgents![0]!.totalTokens, 200);
});

test("empty native history uses the snapshot timezone to anchor all source calendars", () => {
  const value = snapshot();
  value.generatedAt = Date.UTC(2026, 9, 9, 18);
  for (const source of ["native", "all", "acp:codex", "acp:claude"]) {
    const activity = projectAppUsageHeatmap(value, source);
    assert.equal(activity.endDate, "2026-10-10");
    assert.equal(activity.weeks.length, 52);
  }
});
