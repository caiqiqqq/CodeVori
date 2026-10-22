import assert from "node:assert/strict";
import test from "node:test";
import type { AppUsageSnapshot } from "@zcode/shared";
import { buildAppUsageDailyModelChartViewModel } from "../src/settings/usage-stats/appUsageTrendChartViewModel.js";

function fixture(): AppUsageSnapshot {
  const ids = ["Codex ACP · gpt", "glm", ...Array.from({ length: 6 }, (_, i) => `model-${i}`)];
  return {
    models: ids.map((modelId, i) => ({ modelId, totalTokens: i === 0 ? 760_000_000 : 20_000 })),
    dailyModelUsage: [
      { date: "2026-10-11", models: ids.map((modelId) => ({ modelId, totalTokens: 20_000 })) },
      {
        date: "2026-10-12",
        models: [
          { modelId: ids[0], totalTokens: 40_000_000 },
          { modelId: "glm", totalTokens: 0 },
        ],
      },
    ],
  } as AppUsageSnapshot;
}

const intl = { formatMessage: () => "Unknown" } as never;

test("defaults to the total of all model facts, including unknown models, without mutation", () => {
  const snapshot = fixture();
  snapshot.dailyModelUsage[0]!.models.push({ modelId: null, totalTokens: 30_000 });
  snapshot.dailyModelUsage.push({ date: "2026-10-13", models: [] });
  const before = structuredClone(snapshot);
  const view = buildAppUsageDailyModelChartViewModel({ intl, locale: "en", snapshot });
  assert.deepEqual(
    view.visibleSeriesKeys.map((series) => series.key),
    ["totalUsage"],
  );
  assert.equal(view.visibleModelKeys.length, 0);
  assert.equal(view.chartData[0]?.totalUsage, 190_000);
  assert.equal(view.chartData[1]?.totalUsage, 40_000_000);
  assert.equal(view.chartData[2]?.totalUsage, null);
  assert.equal(view.maxTokens, 40_000_000);
  assert.deepEqual(snapshot, before);
});

test("model visibility never changes total usage or double-counts tooltip totals", () => {
  const snapshot = fixture();
  const view = buildAppUsageDailyModelChartViewModel({
    intl,
    locale: "en",
    snapshot,
    selectedModelIds: new Set(["glm"]),
  });
  assert.equal(view.visibleSeriesKeys.length, 2);
  assert.equal(view.chartData[0]?.totalUsage, 160_000);
  assert.equal(view.chartData[0]?.total, 160_000);
  assert.equal(view.chartData[1]?.totalUsage, 40_000_000);
  assert.equal(view.maxTokens, 40_000_000);
});

test("zero/missing GLM usage has no point today while actual Codex usage remains", () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const view = buildAppUsageDailyModelChartViewModel({
    intl,
    locale: "en",
    snapshot,
    showTotal: false,
    selectedModelIds: new Set(snapshot.models.map((model) => model.modelId)),
  });
  assert.equal(view.chartData[0]?.model1, 20_000);
  assert.equal(view.chartData[1]?.model1, null);
  assert.equal(view.chartData[1]?.model2, null);
  assert.equal(view.chartData[1]?.model0, 40_000_000);
  assert.equal(view.chartData[1]?.total, 40_000_000);
  assert.deepEqual(snapshot, before);
});

test("all models remain selectable and hiding Codex rescales to small-model peak", () => {
  const snapshot = fixture();
  const view = buildAppUsageDailyModelChartViewModel({
    intl,
    locale: "en",
    snapshot,
    showTotal: false,
    selectedModelIds: new Set(snapshot.models.slice(1).map((model) => model.modelId)),
  });
  assert.equal(view.modelKeys.length, 8);
  assert.equal(view.visibleModelKeys.length, 7);
  assert.equal(view.maxTokens, 20_000);
  assert.equal(view.chartData[0]?.total, 140_000);
  assert.equal(view.chartData[1]?.total, 0);
});

test("hiding all models preserves legend choices without fabricating usage", () => {
  const snapshot = fixture();
  const view = buildAppUsageDailyModelChartViewModel({
    intl,
    locale: "en",
    snapshot,
    showTotal: false,
    selectedModelIds: new Set(),
  });
  assert.equal(view.modelKeys.length, 8);
  assert.equal(view.visibleModelKeys.length, 0);
  assert.equal(view.maxTokens, 0);
  assert.equal(
    view.chartData.every((row) => row.total === 0),
    true,
  );
});
