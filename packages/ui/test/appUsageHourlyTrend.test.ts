import assert from "node:assert/strict";
import test from "node:test";
import { createAppUsageHourlyAccumulator, appUsageHourlyModelUsageSchema } from "@zcode/shared";
import { projectAppUsageCharts } from "../src/settings/usage-stats/appUsageSources.js";
import { buildAppUsageDailyModelChartViewModel } from "../src/settings/usage-stats/AppUsageDailyModelTrendChart.js";
import { appUsageSnapshotSchema } from "@zcode/shared";

test("today uses local midnight, excludes missing/future dates and combines model facts", () => {
  const until = Date.parse("2026-10-13T12:00:00Z");
  const accumulator = createAppUsageHourlyAccumulator("Asia/Shanghai", until);
  const add = (at: string | null, tokens: number, modelId: string | null = "model") =>
    accumulator.add(at === null ? null : Date.parse(at), [{ modelId, totalTokens: tokens }]);
  add("2026-10-12T15:59:59Z", 999);
  add("2026-10-12T16:00:00Z", 10);
  add("2026-10-12T16:59:59Z", 20);
  add("2026-10-12T17:00:00Z", 5, null);
  add("2026-10-13T12:00:01Z", 999);
  add(null, 999);
  const result = appUsageHourlyModelUsageSchema.parse(accumulator.usage);
  assert.equal(result.date, "2026-10-13");
  assert.equal(result.hours.length, 24);
  assert.deepEqual(result.hours[0], { hour: 0, models: [{ modelId: "model", totalTokens: 30 }] });
  assert.deepEqual(result.hours[1]?.models, [{ modelId: null, totalTokens: 5 }]);
  assert.deepEqual(result.hours[2]?.models, []);
  assert.equal(
    appUsageHourlyModelUsageSchema.safeParse({ ...result, hours: [{ hour: 24, models: [] }] })
      .success,
    false,
  );
});

test("half-hour offsets and DST repeated hours use the timestamp's actual timezone", () => {
  const half = createAppUsageHourlyAccumulator("Asia/Kolkata", Date.parse("2026-10-13T10:00Z"));
  half.add(Date.parse("2026-10-12T18:29:59Z"), [{ modelId: "model", totalTokens: 999 }]);
  half.add(Date.parse("2026-10-12T18:30Z"), [{ modelId: "model", totalTokens: 10 }]);
  assert.equal(half.usage.hours[0]?.models[0]?.totalTokens, 10);
  const dst = createAppUsageHourlyAccumulator("America/New_York", Date.parse("2026-11-01T20:00Z"));
  for (const time of ["2026-11-01T05:30Z", "2026-11-01T06:30Z"])
    dst.add(Date.parse(time), [{ modelId: "model", totalTokens: 10 }]);
  assert.equal(dst.usage.hours[1]?.models[0]?.totalTokens, 20);
  const spring = createAppUsageHourlyAccumulator(
    "America/New_York",
    Date.parse("2026-03-08T20:00Z"),
  );
  spring.add(Date.parse("2026-03-08T07:30Z"), [{ modelId: "model", totalTokens: 10 }]);
  assert.deepEqual(spring.usage.hours[2]?.models, []);
  assert.equal(spring.usage.hours[3]?.models[0]?.totalTokens, 10);
});

function snapshot() {
  const until = Date.parse("2026-10-13T12:00Z");
  const native = createAppUsageHourlyAccumulator("UTC", until);
  const acp = createAppUsageHourlyAccumulator("UTC", until);
  native.add(until, [{ modelId: "model", totalTokens: 10 }]);
  acp.add(until, [{ modelId: "model", totalTokens: 20 }]);
  return appUsageSnapshotSchema.parse({
    range: "7d",
    generatedAt: until,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 100,
      inputTokens: 100,
      outputTokens: 0,
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
    dailyModelUsage: [],
    hourlyModelUsage: native.usage,
    models: [
      {
        modelId: "model",
        totalTokens: 100,
        inputTokens: 100,
        outputTokens: 0,
        requestCount: 1,
        share: 1,
      },
    ],
    tools: [],
    acpAgents: [
      {
        agent: "codex",
        sessions: 1,
        turns: 1,
        measuredTurns: 1,
        unknownTurns: 0,
        totalTokens: 200,
        inputTokens: 200,
        outputTokens: 0,
        models: [{ modelId: "model", totalTokens: 200, inputTokens: 200, outputTokens: 0 }],
        hourlyUsage: acp.usage,
      },
    ],
  });
}

test("hourly source projection isolates facts, preserves inputs and never fills missing old data", () => {
  const value = snapshot();
  const before = structuredClone(value);
  assert.deepEqual(projectAppUsageCharts(value, "all").hourlyModelUsage?.hours[12]?.models, [
    { modelId: "model", totalTokens: 10 },
    { modelId: "Codex ACP · model", totalTokens: 20 },
  ]);
  assert.equal(
    projectAppUsageCharts(value, "acp:codex").hourlyModelUsage?.hours[12]?.models.length,
    1,
  );
  assert.deepEqual(value, before);
  delete value.acpAgents![0]!.hourlyUsage;
  assert.equal(projectAppUsageCharts(value, "all").hourlyModelUsage, undefined);
  assert.ok(projectAppUsageCharts(value, "native").hourlyModelUsage);
  assert.equal(projectAppUsageCharts(value, "acp:codex").hourlyModelUsage, undefined);
  value.acpAgents![0]!.hourlyUsage = { ...before.acpAgents![0]!.hourlyUsage!, date: "2026-10-12" };
  assert.equal(projectAppUsageCharts(value, "all").hourlyModelUsage, undefined);
});

test("hourly chart uses today's models and visible point peak rather than lifetime totals", () => {
  const value = projectAppUsageCharts(snapshot(), "all");
  const view = buildAppUsageDailyModelChartViewModel({
    intl: { formatMessage: () => "Unknown" } as never,
    locale: "en",
    snapshot: value,
    granularity: "hourly",
    hiddenModelIds: new Set(["Codex ACP · model"]),
  });
  assert.equal(view.chartData.length, 24);
  assert.equal(view.topModels[0]?.totalTokens, 20);
  assert.equal(view.chartData[12]?.label, "12:00");
  assert.equal(view.chartData[12]?.tooltipLabel, "12:00");
  assert.equal(view.chartData[12]?.total, 10);
  assert.equal(view.maxTokens, 10);
  assert.equal(view.chartData[0]?.model1, null);
});
