import type { AppUsageHeatmap, AppUsageHeatmapCell, AppUsageSnapshot } from "@zcode/shared";

const DAY_MS = 86_400_000;
const WEEK_COUNT = 52;

function snapshotEndDate(snapshot: AppUsageSnapshot): string {
  if (snapshot.heatmap.endDate) return snapshot.heatmap.endDate;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: snapshot.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(snapshot.generatedAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** 只读全年活动投影；来源事实仍由 Host 的统计快照持有。 */
export function projectAppUsageHeatmap(
  snapshot: AppUsageSnapshot,
  source: string,
): AppUsageHeatmap {
  const endDate = snapshotEndDate(snapshot);
  const endDay = Math.floor(new Date(`${endDate}T00:00:00Z`).getTime() / DAY_MS);
  const lastWeekStart = endDay - new Date(endDay * DAY_MS).getUTCDay();
  const startDay = lastWeekStart - (WEEK_COUNT - 1) * 7;
  const cells = new Map<string, AppUsageHeatmapCell>();

  if (source === "native" || source === "all") {
    for (const week of snapshot.heatmap.weeks) {
      for (const cell of week.days) {
        if (cell) cells.set(cell.date, { ...cell });
      }
    }
  }
  // 原活动图只读取 API 热力图，导致全部来源和 ACP 缺少自己的活动。
  // ACP 只能按已有每日模型事实合计；不把无日期总量补到今天，也不借用 API 消息轮数。
  for (const agent of snapshot.acpAgents ?? []) {
    if (source !== "all" && source !== `acp:${agent.agent}`) continue;
    for (const day of agent.dailyUsage ?? []) {
      const totalTokens = day.models.reduce((total, model) => total + model.totalTokens, 0);
      const current = cells.get(day.date);
      cells.set(day.date, {
        date: day.date,
        level: 0,
        totalTokens: (current?.totalTokens ?? 0) + totalTokens,
        // ACP 的每日轮数尚未提供；调用方使用 tokens 提示，不把这里的占位值展示成事实。
        turnCount: 0,
        toolCallCount: 0,
      });
    }
  }

  const days = Array.from({ length: WEEK_COUNT * 7 }, (_, index): AppUsageHeatmapCell => {
    const dayIndex = startDay + index;
    const date = new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
    const cell = dayIndex <= endDay ? cells.get(date) : undefined;
    return cell ?? { date, level: 0, totalTokens: 0, turnCount: 0, toolCallCount: 0 };
  });
  const maxTokens = days.reduce((max, cell) => Math.max(max, cell.totalTokens), 0);

  return {
    startDate: days[0]!.date,
    endDate,
    maxTokens,
    weeks: Array.from({ length: WEEK_COUNT }, (_, weekIndex) => ({
      weekIndex,
      days: days.slice(weekIndex * 7, (weekIndex + 1) * 7).map((cell) => ({
        ...cell,
        level:
          maxTokens > 0 && cell.totalTokens > 0
            ? (Math.min(
                4,
                Math.ceil((cell.totalTokens / maxTokens) * 4),
              ) as AppUsageHeatmapCell["level"])
            : 0,
      })),
    })),
  };
}
