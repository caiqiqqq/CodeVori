import type { AppUsageDailyModelItem, AppUsageHourlyModelUsage } from "./usage-stats.js";

const HOURLY_USAGE_LOOKBACK_MS = 2 * 86_400_000;

/** Pure read projection shared by API requests and confirmed ACP usage facts. */
export function createAppUsageHourlyAccumulator(timeZone: string | undefined, until: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const calendar = (time: number) => {
    const parts = formatter.formatToParts(time);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
  };
  const usage: AppUsageHourlyModelUsage = {
    date: calendar(until).date,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, models: [] })),
  };
  return {
    usage,
    add(timestamp: number | null, models: readonly AppUsageDailyModelItem[]) {
      if (
        timestamp === null ||
        !Number.isFinite(timestamp) ||
        timestamp > until ||
        timestamp < until - HOURLY_USAGE_LOOKBACK_MS
      )
        return;
      // 每条时间戳按真实时区归桶，固定偏移会在夏令时或半小时时区把小时分错。
      const { date, hour } = calendar(timestamp);
      if (date !== usage.date) return;
      const target = usage.hours[hour]!.models;
      for (const model of models) {
        if (!(model.totalTokens > 0)) continue;
        const existing = target.find((item) => item.modelId === model.modelId);
        if (existing) existing.totalTokens += model.totalTokens;
        else target.push({ modelId: model.modelId, totalTokens: model.totalTokens });
      }
    },
  };
}
