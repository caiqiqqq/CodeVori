import { type ComponentProps, useCallback, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AppUsageSnapshot } from "@zcode/shared";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  UsageEmptyState,
  formatCompactTokenUsage,
  formatDay,
  resolveModelLabel,
} from "@/settings/usage-stats/usageStatsUiParts.js";
import { getAppUsageModelChartColor } from "@/settings/usage-stats/appUsageChartPalette.js";
import { Button } from "@/components/ui/button.js";

// XAxis 首尾刻度以绘图区边界为中心向两侧延伸，原 8px margin 小于日期文本半宽，
// SVG 会裁掉首尾文字；左右保留 24px 安全区，让桌面端与手机 Web 端都能完整显示短日期。
export const APP_USAGE_TREND_CHART_MARGIN = {
  top: 8,
  right: 24,
  left: 24,
} as const;

type DailyModelChartRow = {
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
type ChartTooltipContentProps = ComponentProps<typeof ChartTooltipContent>;

export function filterDailyModelTooltipPayload<T extends { value?: unknown }>(
  payload: readonly T[] | undefined,
): T[] {
  // Recharts 的多序列 tooltip payload 会包含当天所有模型；
  // 0 用量模型没有可见趋势点，继续展示会误导用户以为 hover 到了有效用量。
  return (payload ?? []).filter((item) => {
    const value = typeof item.value === "number" ? item.value : Number(item.value);
    return Number.isFinite(value) && value > 0;
  });
}

export function resolveDailyModelTooltipTokenParts(
  locale: string,
  value: unknown,
  tokenUnit: string,
): { number: string; unit: string } {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return { number: String(value), unit: "" };
  }
  return {
    number: formatCompactTokenUsage(locale, numericValue),
    unit: tokenUnit,
  };
}

function shouldShowDailyChartAxisLabel(index: number, total: number): boolean {
  if (total <= 14) {
    return true;
  }
  const step = total > 45 ? 7 : 5;
  return index === 0 || index === total - 1 || index % step === 0;
}

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
}: {
  snapshot: AppUsageSnapshot;
  locale: string;
  modelKeys: ModelChartKey[];
  modelKeyById: Map<string, string>;
}): DailyModelChartRow[] {
  const rows = new Map<string, DailyModelChartRow>();

  // App Usage 的 30d 协议结果已经是每日序列，旧 all 分桶残留把
  // 30 天按周聚合成约 5 个点，导致“最近 30 天”没有连续每日趋势。
  for (const day of snapshot.dailyModelUsage) {
    const label = formatDay(locale, day.date);
    const row = rows.get(day.date) ?? createEmptyChartRow(label, label, modelKeys);

    for (const model of day.models) {
      const key = modelKeyById.get(model.modelId ?? "__unknown__");
      if (key && model.totalTokens > 0) {
        row[key] = Number(row[key] ?? 0) + model.totalTokens;
        row.total += model.totalTokens;
      }
    }

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
  hiddenModelIds,
}: {
  intl: UsageIntl;
  locale: string;
  snapshot: AppUsageSnapshot;
  hiddenModelIds?: ReadonlySet<string | null>;
}) {
  // 截取前六项会直接丢失小用量模型；保留全部正用量项供图例选择。
  const topModels = snapshot.models.filter((model) => model.totalTokens > 0);
  const modelKeys = topModels.map((model, index) => ({
    modelId: model.modelId,
    key: `model${index}`,
    color: getAppUsageModelChartColor(index),
    label: resolveModelLabel(intl, model.modelId),
  }));
  const visibleModelKeys = modelKeys.filter((model) => !hiddenModelIds?.has(model.modelId));
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
  const chartData = buildDailyModelChartData({
    snapshot,
    locale,
    modelKeys,
    modelKeyById,
  });
  let maxTokens = 0;
  // 图中是独立折线而非堆叠图，使用每日总量会把多模型之和（以及未展示模型）
  // 当作 Y 轴上限，导致实际可见曲线被压在底部；坐标范围只应跟随可见序列的单点峰值。
  for (const row of chartData) {
    for (const model of visibleModelKeys) {
      maxTokens = Math.max(maxTokens, Number(row[model.key] ?? 0));
    }
  }

  return {
    topModels,
    modelKeys,
    visibleModelKeys,
    chartConfig,
    chartData,
    maxTokens,
  };
}

function DailyModelChartTooltipContent(props: ChartTooltipContentProps) {
  const filteredPayload = useMemo(
    () => filterDailyModelTooltipPayload(props.payload),
    [props.payload],
  );

  if (!props.active || filteredPayload.length === 0) {
    return null;
  }

  return <ChartTooltipContent {...props} payload={filteredPayload} />;
}

export function AppUsageDailyModelTrendChart({ snapshot }: { snapshot: AppUsageSnapshot }) {
  const { intl, locale } = useZCodeIntl();
  const [hiddenModelIds, setHiddenModelIds] = useState<ReadonlySet<string | null>>(() => new Set());
  const { topModels, visibleModelKeys, chartConfig, chartData, maxTokens } = useMemo(
    // Recharts 3.8 会把 data / legend / graphical item props 写入内部 store。
    // 这里稳定派生数组和配置对象，避免父组件重渲染时因引用变化反复触发内部 dispatch。
    () => buildAppUsageDailyModelChartViewModel({ intl, locale, snapshot, hiddenModelIds }),
    [intl, locale, snapshot, hiddenModelIds],
  );
  const shouldShowAxisLabel = useCallback(
    (_value: string, index: number) =>
      shouldShowDailyChartAxisLabel(index, chartData.length) ? _value : "",
    [chartData.length],
  );
  const formatTooltipLabel = useCallback(
    (_: unknown, payload: readonly { payload?: unknown }[]) => {
      const row = payload[0]?.payload as DailyModelChartRow | undefined;
      const total = typeof row?.total === "number" ? row.total : 0;
      return `${row?.tooltipLabel ?? ""} - ${formatCompactTokenUsage(locale, total)} ${intl.formatMessage(
        {
          id: "settings.usage.tokenUnit",
        },
      )}`;
    },
    [intl, locale],
  );
  const tokenUnit = intl.formatMessage({ id: "settings.usage.tokenUnit" });
  const formatTooltipItem = useCallback(
    (value: unknown, name: unknown, item: { color?: string }) => {
      const itemName = String(name);
      const label = chartConfig[itemName]?.label ?? itemName;
      const color = item.color ?? `var(--color-${itemName})`;
      const tokenValue = resolveDailyModelTooltipTokenParts(locale, value, tokenUnit);
      return (
        <>
          <span
            className="size-2 shrink-0 self-center rounded-full"
            style={{ backgroundColor: color }}
          />
          <div className="flex flex-1 items-center justify-between gap-3">
            <span className="text-foreground-subtle">{label}</span>
            <span className="flex items-baseline gap-1 text-foreground">
              <span className="font-mono font-medium tabular-nums">{tokenValue.number}</span>
              {tokenValue.unit ? (
                <span className="text-foreground-subtle">{tokenValue.unit}</span>
              ) : null}
            </span>
          </div>
        </>
      );
    },
    [chartConfig, locale, tokenUnit],
  );
  const tooltipContent = useMemo(
    () => (
      <DailyModelChartTooltipContent
        indicator="line"
        labelFormatter={formatTooltipLabel}
        formatter={formatTooltipItem}
      />
    ),
    [formatTooltipItem, formatTooltipLabel],
  );

  return (
    <section className="space-y-3 rounded-xl bg-surface p-4" data-testid="app-usage-daily-trend">
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.usage.dailyChartTitle" })}
      </h3>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" role="list">
        {topModels.map((model, index) => (
          <div key={model.modelId ?? "__unknown__"} role="listitem" className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={!hiddenModelIds.has(model.modelId)}
              className="max-w-full gap-2 text-ui-sm aria-pressed:opacity-100 [&[aria-pressed=false]]:opacity-50"
              onClick={() =>
                setHiddenModelIds((current) => {
                  const next = new Set(current);
                  if (next.has(model.modelId)) next.delete(model.modelId);
                  else next.add(model.modelId);
                  return next;
                })
              }
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: getAppUsageModelChartColor(index) }}
              />
              <span className="truncate font-mono text-foreground-subtle">
                {resolveModelLabel(intl, model.modelId)}
              </span>
            </Button>
          </div>
        ))}
      </div>
      {maxTokens <= 0 ? (
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.emptyTitle" })}
          description={intl.formatMessage({
            id: "settings.usage.emptyDescription",
          })}
        />
      ) : (
        <div>
          <ChartContainer config={chartConfig} className="h-60 w-full">
            <LineChart accessibilityLayer data={chartData} margin={APP_USAGE_TREND_CHART_MARGIN}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={0}
                minTickGap={0}
                tickMargin={8}
                tickFormatter={shouldShowAxisLabel}
              />
              <YAxis hide domain={[0, maxTokens]} />
              <ChartTooltip cursor={false} content={tooltipContent} />
              {visibleModelKeys.map((model) => (
                <Line
                  key={model.key}
                  dataKey={model.key}
                  type="monotone"
                  stroke={`var(--color-${model.key})`}
                  strokeWidth={2}
                  // 正数点让仅有一天用量的小模型也可见；空值不会生成普通点或高亮点。
                  dot={{ r: 2, fill: `var(--color-${model.key})` }}
                  activeDot={{ r: 4 }}
                  // 切换来源/范围时直接展示完整统计，避免绘制动画让已知曲线暂时缺段。
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </section>
  );
}
