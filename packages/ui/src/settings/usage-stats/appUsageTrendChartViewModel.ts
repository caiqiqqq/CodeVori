import type { AppUsageSnapshot } from "@zcode/shared";
import type { ChartConfig } from "@/components/ui/chart.js";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatDay, resolveModelLabel } from "@/settings/usage-stats/usageStatsUiParts.js";
import { getAppUsageModelChartColor } from "@/settings/usage-stats/appUsageChartPalette.js";

export type DailyModelChartRow = {
  label: string;
  tooltipLabel: string;
  total: number;
} & Record<string, number | string | null>;

type ModelChartKey = {
  modelId: string | null;
  key: string;
  color: string;
  label: string;
};
type UsageIntl = ReturnType<typeof useZCodeIntl>["intl"];
function createEmptyChartRow(label: string, tooltipLabel: string, modelKeys: ModelChartKey[]) {
  const row: DailyModelChartRow = {
    label,
    tooltipLabel,
    total: 0,
  };

  for (const model of modelKeys) {
    // 当天无用量不是一个可 hover 的模型请求；零点会误导用户以为今天使用过 GLM。
    row[model.key] = null;
  }

  return row;
}

function buildDailyModelChartData({
  snapshot,
  locale,
  modelKeys,
  modelKeyById,
  granularity,
  showTotal,
}: {
  snapshot: AppUsageSnapshot;
  locale: string;
  modelKeys: ModelChartKey[];
  modelKeyById: Map<string, string>;
  granularity: "daily" | "hourly";
  showTotal: boolean;
}): DailyModelChartRow[] {
  const rows = new Map<string, DailyModelChartRow>();

  // App Usage 的 30d 协议结果已经是每日序列，旧 all 分桶残留把
  // 30 天按周聚合成约 5 个点，导致“最近 30 天”没有连续每日趋势。
  const buckets =
    granularity === "hourly"
      ? (snapshot.hourlyModelUsage?.hours ?? []).map((hour) => ({
          date: String(hour.hour).padStart(2, "0"),
          models: hour.models,
        }))
      : snapshot.dailyModelUsage;
  for (const day of buckets) {
    const label = granularity === "hourly" ? `${day.date}:00` : formatDay(locale, day.date);
    const row = rows.get(day.date) ?? createEmptyChartRow(label, label, modelKeys);

    for (const model of day.models) {
      // 总量从全部模型事实汇总，不受图例开关影响，也不叠加已有汇总字段。
      if (model.totalTokens > 0) {
        row.totalUsage = Number(row.totalUsage ?? 0) + model.totalTokens;
      }
      const key = modelKeyById.get(model.modelId ?? "__unknown__");
      if (key && model.totalTokens > 0) {
        row[key] = Number(row[key] ?? 0) + model.totalTokens;
        row.total += model.totalTokens;
      }
    }

    row.totalUsage ??= null;
    // 同时展示总量和单模型时，tooltip 标题只统计一次。
    if (showTotal) row.total = Number(row.totalUsage ?? 0);
    rows.set(day.date, row);
  }

  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
}

export function buildAppUsageDailyModelChartViewModel({
  intl,
  locale,
  snapshot,
  selectedModelIds,
  showTotal = true,
  granularity = "daily",
}: {
  intl: UsageIntl;
  locale: string;
  snapshot: AppUsageSnapshot;
  selectedModelIds?: ReadonlySet<string | null>;
  showTotal?: boolean;
  granularity?: "daily" | "hourly";
}) {
  // 截取前六项会直接丢失小用量模型；保留全部正用量项供图例选择。
  const todayModels = new Map<string | null, { modelId: string | null; totalTokens: number }>();
  if (granularity === "hourly")
    for (const hour of snapshot.hourlyModelUsage?.hours ?? [])
      for (const model of hour.models) {
        const current = todayModels.get(model.modelId) ?? {
          modelId: model.modelId,
          totalTokens: 0,
        };
        current.totalTokens += model.totalTokens;
        todayModels.set(model.modelId, current);
      }
  const topModels = (
    granularity === "hourly"
      ? [...todayModels.values()].sort((a, b) => b.totalTokens - a.totalTokens)
      : snapshot.models
  ).filter((model) => model.totalTokens > 0);
  const modelKeys = topModels.map((model, index) => ({
    modelId: model.modelId,
    key: `model${index}`,
    color: getAppUsageModelChartColor(index),
    label: resolveModelLabel(intl, model.modelId),
  }));
  const visibleModelKeys = modelKeys.filter((model) => selectedModelIds?.has(model.modelId));
  const totalSeries = {
    key: "totalUsage",
    label: intl.formatMessage({ id: "settings.usage.trendTotal" }),
    color: "var(--color-brand)",
  };
  const visibleSeriesKeys = showTotal ? [totalSeries, ...visibleModelKeys] : visibleModelKeys;
  const modelKeyById = new Map(
    visibleModelKeys.map((model) => [model.modelId ?? "__unknown__", model.key]),
  );
  const chartConfig = modelKeys.reduce<ChartConfig>((config, model) => {
    config[model.key] = {
      label: model.label,
      color: model.color,
    };
    return config;
  }, {});
  chartConfig[totalSeries.key] = { label: totalSeries.label, color: totalSeries.color };
  const chartData = buildDailyModelChartData({
    snapshot,
    locale,
    modelKeys,
    modelKeyById,
    granularity,
    showTotal,
  });
  let maxTokens = 0;
  // Y 轴跟随当前可见总量／模型在单个时间桶内的峰值。
  for (const row of chartData) {
    for (const model of visibleSeriesKeys) {
      maxTokens = Math.max(maxTokens, Number(row[model.key] ?? 0));
    }
  }

  return {
    topModels,
    modelKeys,
    visibleModelKeys,
    visibleSeriesKeys,
    totalSeries,
    chartConfig,
    chartData,
    maxTokens,
  };
}
