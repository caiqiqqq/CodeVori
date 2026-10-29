import type { ForgeItem } from "@zcode/shared";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT = 1000;
type DiscoveredIssue = Pick<ForgeItem, "number" | "title" | "url">;
interface DiscoveryBaseline {
  since: number;
  highestNumber: number;
  recent: Array<{ item: DiscoveredIssue; detectedAt: number }>;
}

/** 基线属于 summary owner 的生命周期，不能随远端响应缓存过期而丢失。 */
export function createRepositoryIssueDiscoveries(now: () => number) {
  const baselines = new Map<string, DiscoveryBaseline>();
  return (key: string, items: readonly ForgeItem[], startedAt: number): DiscoveredIssue[] => {
    let baseline = baselines.get(key);
    if (!baseline) {
      baseline = { since: startedAt, highestNumber: 0, recent: [] };
      baselines.set(key, baseline);
      for (const item of items)
        baseline.highestNumber = Math.max(baseline.highestNumber, item.number);
      return [];
    }
    for (const item of items) {
      // 空列表后重新开放历史议题也会增加数量；同时校验创建时间与编号水位才能避免误报。
      if (
        item.number > baseline.highestNumber &&
        Date.parse(item.createdAt ?? "") > baseline.since &&
        item.url &&
        /^https?:\/\//i.test(item.url)
      )
        baseline.recent.push({
          item: { number: item.number, title: item.title, url: item.url },
          detectedAt: now(),
        });
    }
    for (const item of items)
      baseline.highestNumber = Math.max(baseline.highestNumber, item.number);
    // 保留近期检测事实，避免共享读取丢弃旧 RPC 时也丢掉该次新议题；它不是消费式队列。
    baseline.recent = baseline.recent
      .filter((entry) => now() - entry.detectedAt < RETENTION_MS)
      .slice(-MAX_RECENT);
    return baseline.recent.map((entry) => entry.item);
  };
}
