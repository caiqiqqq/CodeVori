import { type ComponentProps, useCallback, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AppUsageSnapshot } from "@zcode/shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  UsageEmptyState,
  formatCompactTokenUsage,
} from "@/settings/usage-stats/usageStatsUiParts.js";
import {
  buildAppUsageDailyModelChartViewModel,
  type DailyModelChartRow,
} from "@/settings/usage-stats/appUsageTrendChartViewModel.js";
import { Button } from "@/components/ui/button.js";

// XAxis 首尾刻度以绘图区边界为中心向两侧延伸，原 8px margin 小于日期文本半宽，
// SVG 会裁掉首尾文字；左右保留 24px 安全区，让桌面端与手机 Web 端都能完整显示短日期。
export const APP_USAGE_TREND_CHART_MARGIN = {
  top: 8,
  right: 24,
  left: 24,
} as const;

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

export function AppUsageDailyModelTrendChart({
  snapshot,
  granularity = "daily",
}: {
  snapshot: AppUsageSnapshot;
  granularity?: "daily" | "hourly";
}) {
  const { intl, locale } = useZCodeIntl();
  const [selection, setSelection] = useState(() => ({
    showTotal: true,
    modelIds: new Set<string | null>(),
  }));
  const { modelKeys, totalSeries, visibleSeriesKeys, chartConfig, chartData, maxTokens } = useMemo(
    // Recharts 3.8 会把 data / legend / graphical item props 写入内部 store。
    // 这里稳定派生数组和配置对象，避免父组件重渲染时因引用变化反复触发内部 dispatch。
    () =>
      buildAppUsageDailyModelChartViewModel({
        intl,
        locale,
        snapshot,
        selectedModelIds: selection.modelIds,
        showTotal: selection.showTotal,
        granularity,
      }),
    [intl, locale, snapshot, selection, granularity],
  );
  const shouldShowAxisLabel = useCallback(
    (_value: string, index: number) =>
      (
        granularity === "hourly"
          ? index % 6 === 0 || index === 23
          : shouldShowDailyChartAxisLabel(index, chartData.length)
      )
        ? _value
        : "",
    [chartData.length, granularity],
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
        // 单序列会将时间嵌入被 formatter 替换的默认行；dot 让时间标题独立渲染。
        indicator="dot"
        labelFormatter={formatTooltipLabel}
        formatter={formatTooltipItem}
      />
    ),
    [formatTooltipItem, formatTooltipLabel],
  );

  return (
    <section
      className="space-y-3 rounded-xl bg-surface p-4"
      data-testid={granularity === "hourly" ? "app-usage-hourly-trend" : "app-usage-daily-trend"}
    >
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({
          id:
            granularity === "hourly"
              ? "settings.usage.hourlyChartTitle"
              : "settings.usage.dailyChartTitle",
        })}
      </h3>
      {granularity === "hourly" && snapshot.hourlyModelUsage ? (
        <p className="text-ui-sm text-foreground-subtle">
          {snapshot.hourlyModelUsage.date} · {snapshot.timeZone}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" role="list">
        <div role="listitem" className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={selection.showTotal}
            className="max-w-full gap-2 text-ui-sm aria-pressed:opacity-100 [&[aria-pressed=false]]:opacity-50"
            onClick={() =>
              setSelection((current) => ({ ...current, showTotal: !current.showTotal }))
            }
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: totalSeries.color }}
            />
            <span className="truncate text-foreground-subtle">{totalSeries.label}</span>
          </Button>
        </div>
        {modelKeys.map((model) => (
          <div key={model.modelId ?? "__unknown__"} role="listitem" className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={selection.modelIds.has(model.modelId)}
              className="max-w-full gap-2 text-ui-sm aria-pressed:opacity-100 [&[aria-pressed=false]]:opacity-50"
              onClick={() =>
                setSelection((current) => {
                  const next = new Set(current.modelIds);
                  if (next.has(model.modelId)) next.delete(model.modelId);
                  else next.add(model.modelId);
                  return { ...current, modelIds: next };
                })
              }
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: model.color }}
              />
              <span className="truncate font-mono text-foreground-subtle">{model.label}</span>
            </Button>
          </div>
        ))}
      </div>
      {maxTokens <= 0 ? (
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.emptyTitle" })}
          description={intl.formatMessage({
            id:
              granularity === "hourly" && !snapshot.hourlyModelUsage
                ? "settings.usage.hourlyUnavailable"
                : "settings.usage.emptyDescription",
          })}
        />
      ) : (
        <div>
          <ChartContainer config={chartConfig} className="h-60 w-full">
            {granularity === "hourly" ? (
              <BarChart accessibilityLayer data={chartData} margin={APP_USAGE_TREND_CHART_MARGIN}>
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
                {visibleSeriesKeys.map((model) => (
                  <Bar
                    key={model.key}
                    dataKey={model.key}
                    fill={`var(--color-${model.key})`}
                    maxBarSize={16}
                    radius={[3, 3, 0, 0]}
                    // 小时是离散时间桶，柱状图避免折线暗示小时间的连续变化。
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            ) : (
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
                {visibleSeriesKeys.map((model) => (
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
            )}
          </ChartContainer>
        </div>
      )}
    </section>
  );
}
