import { projectAppUsageCharts } from "./appUsageSources.js";
import { RefreshCcw } from "lucide-react";
import { Fragment, lazy, useMemo, useState } from "react";
import { APP_USAGE_RANGES, acpAgentDefinition } from "@zcode/shared";
import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useAppUsageStats } from "@/hooks/useUsageStats.js";
import { AcpUsageSourceDetails } from "@/settings/usage-stats/AcpUsageSourceDetails.js";
import { UsageChartLoadBoundary } from "@/settings/usage-stats/UsageChartLoadBoundary.js";
import { UsageHeatmap } from "@/settings/usage-stats/UsageHeatmap.js";
import { UsageStatsErrorNotice } from "@/settings/usage-stats/UsageStatsErrorNotice.js";
import {
  USAGE_STATS_TABS_LIST_CLASS,
  USAGE_STATS_TABS_TRIGGER_CLASS,
  UsageEmptyState,
  formatCompactNumber,
  formatSummaryCompactTokenUsage,
} from "@/settings/usage-stats/usageStatsUiParts.js";

// Recharts 会在模块初始化阶段触发 decimal.js-light 的 LN10 校验，
// 在 Electron Linux 容器里会阻断整个 renderer 启动。图表按需加载后，
// 普通启动和 e2e 首页不会被 Usage 页图表依赖影响，打开 Usage 时也由局部边界隔离。
const AppUsageDailyModelTrendChart = lazy(() =>
  import("@/settings/usage-stats/AppUsageDailyModelTrendChart.js").then((module) => ({
    default: module.AppUsageDailyModelTrendChart,
  })),
);
const AppUsageModelUsagePieChart = lazy(() =>
  import("@/settings/usage-stats/AppUsageModelUsagePieChart.js").then((module) => ({
    default: module.AppUsageModelUsagePieChart,
  })),
);

export function AppUsagePanel() {
  const { intl, locale } = useZCodeIntl();
  const [range, setRange] = useState<AppUsageRange>("7d");
  const [source, setSource] = useState("all");
  const { snapshot: lifetimeSnapshot, refresh: refreshLifetime } = useAppUsageStats("all");
  const { snapshot, loading, error, refresh } = useAppUsageStats(range);
  const acpAgents = snapshot?.acpAgents ?? [];
  const availableAgents = lifetimeSnapshot?.acpAgents ?? acpAgents;
  const historicalAgent = availableAgents.find((item) => source === `acp:${item.agent}`);
  const selectedAgent =
    acpAgents.find((item) => source === `acp:${item.agent}`) ??
    (historicalAgent
      ? {
          ...historicalAgent,
          sessions: 0,
          turns: 0,
          measuredTurns: 0,
          unknownTurns: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          models: [],
          dailyUsage: [],
        }
      : undefined);
  const chartSnapshot = useMemo(
    () =>
      snapshot
        ? projectAppUsageCharts(
            snapshot,
            source,
            intl.formatMessage({ id: "settings.usage.unknownModel" }),
          )
        : null,
    [snapshot, source, intl],
  );

  if (loading && !snapshot) {
    return (
      <div className="space-y-5">
        <AppUsageLifetimeSummaryStrip snapshot={lifetimeSnapshot} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          </div>
          <AppUsageRangeTabs range={range} onRangeChange={setRange} />
        </div>
        {/* App Usage 只聚合本地 session 历史，不能复用 Coding Plan 的 monitor API 加载说明。*/}
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.loadingTitle" })}
          description={intl.formatMessage({
            id: "settings.usage.appUsageLoadingDescription",
          })}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-5">
        <AppUsageLifetimeSummaryStrip snapshot={lifetimeSnapshot} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          </div>
          <AppUsageRangeTabs range={range} onRangeChange={setRange} />
        </div>
        {error ? <UsageStatsErrorNotice error={error} /> : null}
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.emptyTitle" })}
          description={intl.formatMessage({
            id: "settings.usage.emptyDescription",
          })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AppUsageLifetimeSummaryStrip snapshot={lifetimeSnapshot} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
        </div>
        <AppUsageRangeTabs range={range} onRangeChange={setRange} />
      </div>
      {error ? <UsageStatsErrorNotice error={error} /> : null}
      <Tabs value={source} onValueChange={setSource} data-testid="app-usage-sources">
        {/* 智能体数量不固定，窄屏换行时列表需随内容增高，固定 h-7 会覆盖下方统计。 */}
        <TabsList
          className={`${USAGE_STATS_TABS_LIST_CLASS} h-auto max-w-full flex-wrap gap-1 group-data-horizontal/tabs:h-auto`}
        >
          <TabsTrigger value="all" className={USAGE_STATS_TABS_TRIGGER_CLASS}>
            {intl.formatMessage({ id: "settings.usage.sourceAll" })}
          </TabsTrigger>
          <TabsTrigger value="native" className={USAGE_STATS_TABS_TRIGGER_CLASS}>
            {intl.formatMessage({ id: "settings.usage.sourceNative" })}
          </TabsTrigger>
          {availableAgents.map((item) => (
            <TabsTrigger
              key={item.agent}
              value={`acp:${item.agent}`}
              className={USAGE_STATS_TABS_TRIGGER_CLASS}
            >
              {acpAgentDefinition(item.agent).name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {selectedAgent ? <AcpUsageSourceDetails agent={selectedAgent} /> : null}
      {chartSnapshot ? (
        <section
          className="space-y-5"
          data-testid={selectedAgent ? "app-usage-acp-charts" : "app-usage-native-charts"}
        >
          <h3 className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({
              id:
                source === "native"
                  ? "settings.usage.nativeModelCharts"
                  : "settings.usage.allModelCharts",
            })}
          </h3>
          {source === "native" ? (
            <AppUsageLifetimeSummaryStrip snapshot={lifetimeSnapshot} nativeOnly />
          ) : null}
          {source === "native" && lifetimeSnapshot?.heatmap.weeks.length ? (
            <UsageHeatmap locale={locale} intl={intl} weeks={lifetimeSnapshot.heatmap.weeks} />
          ) : null}
          <UsageChartLoadBoundary
            scope="settings.usage.app-daily-model-chart"
            resetKeys={[snapshot.range, snapshot.generatedAt]}
            loadingDescription={intl.formatMessage({
              id: "settings.usage.appUsageLoadingDescription",
            })}
          >
            <AppUsageDailyModelTrendChart snapshot={chartSnapshot} />
          </UsageChartLoadBoundary>
          <UsageChartLoadBoundary
            scope="settings.usage.app-model-pie-chart"
            resetKeys={[snapshot.range, snapshot.generatedAt, "model-pie"]}
            loadingDescription={intl.formatMessage({
              id: "settings.usage.appUsageLoadingDescription",
            })}
          >
            <AppUsageModelUsagePieChart snapshot={chartSnapshot} />
          </UsageChartLoadBoundary>
        </section>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-md bg-background"
          onClick={() => {
            void Promise.all([refresh(), refreshLifetime()]);
          }}
        >
          <RefreshCcw className="size-3.5" />
          {intl.formatMessage({ id: "settings.usage.refresh" })}
        </Button>
      </div>
    </div>
  );
}

function AppUsageLifetimeSummaryStrip({
  snapshot,
  nativeOnly = false,
}: {
  snapshot: AppUsageSnapshot | null;
  nativeOnly?: boolean;
}) {
  const { intl, locale } = useZCodeIntl();
  const agents = snapshot?.acpAgents ?? [];
  const acpTokens = agents.reduce((total, agent) => total + agent.totalTokens, 0);
  const unknownTurns = agents.reduce((total, agent) => total + agent.unknownTurns, 0);
  const items = nativeOnly
    ? [
        {
          label: intl.formatMessage({ id: "settings.usage.lifetimeTotalTokens" }),
          value: snapshot
            ? formatSummaryCompactTokenUsage(locale, snapshot.summary.totalTokens)
            : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.lifetimePeakTokens" }),
          value: snapshot
            ? formatSummaryCompactTokenUsage(locale, snapshot.summary.peakDayTokens)
            : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.longestSession" }),
          value: snapshot ? formatAppUsageDuration(snapshot.summary.longestSessionMs, intl) : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.currentStreak" }),
          value: snapshot
            ? `${formatCompactNumber(locale, snapshot.summary.currentStreakDays)} ${intl.formatMessage({ id: "settings.usage.duration.day" })}`
            : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.longestStreak" }),
          value: snapshot
            ? `${formatCompactNumber(locale, snapshot.summary.longestStreakDays)} ${intl.formatMessage({ id: "settings.usage.duration.day" })}`
            : "--",
        },
      ]
    : [
        {
          label: intl.formatMessage({ id: "settings.usage.lifetimeTotalTokens" }),
          value: snapshot
            ? formatSummaryCompactTokenUsage(locale, snapshot.summary.totalTokens + acpTokens)
            : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.sourceNative" }),
          value: snapshot
            ? formatSummaryCompactTokenUsage(locale, snapshot.summary.totalTokens)
            : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.sourceAcp" }),
          value: snapshot ? formatSummaryCompactTokenUsage(locale, acpTokens) : "--",
        },
        {
          label: intl.formatMessage({ id: "settings.usage.unknownTurns" }),
          value: snapshot ? formatCompactNumber(locale, unknownTurns) : "--",
        },
      ];

  return (
    <section
      className="flex flex-col overflow-hidden rounded-xl bg-surface sm:flex-row sm:items-center"
      data-testid={nativeOnly ? "app-usage-native-summary" : "app-usage-lifetime-summary"}
    >
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? (
            <div aria-hidden="true" className="hidden h-7 w-px bg-border sm:block" />
          ) : null}
          <div className="min-w-0 flex-1 px-4 py-3 text-center">
            <div className="truncate text-ui-lg font-medium text-foreground">{item.value}</div>
            <div className="mt-1 truncate text-ui-base text-foreground-subtle">{item.label}</div>
          </div>
        </Fragment>
      ))}
    </section>
  );
}

export function formatAppUsageDuration(
  durationMs: number,
  intl: ReturnType<typeof useZCodeIntl>["intl"],
): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${intl.formatMessage({ id: "settings.usage.duration.day" })}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${intl.formatMessage({ id: "settings.usage.duration.hour" })}`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} ${intl.formatMessage({ id: "settings.usage.duration.minute" })}`);
  }
  return parts.join(" ");
}

function AppUsageRangeTabs({
  range,
  onRangeChange,
}: {
  range: AppUsageRange;
  onRangeChange: (range: AppUsageRange) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Tabs
      value={range}
      onValueChange={(value) => onRangeChange(value as AppUsageRange)}
      className="shrink-0"
    >
      <TabsList className={USAGE_STATS_TABS_LIST_CLASS}>
        {APP_USAGE_RANGES.map((option) => (
          <TabsTrigger key={option} value={option} className={USAGE_STATS_TABS_TRIGGER_CLASS}>
            {intl.formatMessage({ id: `settings.usage.range.${option}` })}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
