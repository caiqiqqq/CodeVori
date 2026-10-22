import type { IUsageStatsService } from "@zcode/services";
import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";

type UsageReader = Pick<IUsageStatsService, "getAppUsageSnapshot">;
interface CacheEntry {
  snapshot: AppUsageSnapshot | null;
  inFlight?: Promise<AppUsageSnapshot>;
}

// 只缓存服务返回的只读投影；WeakMap 以目标 Host 的服务实例隔离，不能跨 Host 复用。
const snapshots = new WeakMap<UsageReader, Map<string, CacheEntry>>();
const MAX_SCOPES = 6;
const scopeKey = (request: AppUsageRequest) => JSON.stringify([request.range, request.timeZone]);

function trim(entries: Map<string, CacheEntry>) {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_SCOPES) break;
    if (!entry.inFlight) entries.delete(key);
  }
}

export function getCachedAppUsageSnapshot(service: UsageReader, request: AppUsageRequest) {
  const entries = snapshots.get(service);
  const key = scopeKey(request);
  const entry = entries?.get(key);
  if (entry) {
    entries!.delete(key);
    entries!.set(key, entry);
  }
  return entry?.snapshot ?? null;
}

export function readAppUsageSnapshot(
  service: UsageReader,
  request: AppUsageRequest,
): Promise<AppUsageSnapshot> {
  let entries = snapshots.get(service);
  if (!entries) {
    entries = new Map();
    snapshots.set(service, entries);
  }
  const key = scopeKey(request);
  const entry = entries.get(key) ?? { snapshot: null };
  if (entry.inFlight) return entry.inFlight;
  // 修复原因：全部时间有两个订阅，卸载重开也会丢失投影；同 scope 共用在途读取，
  // 成功快照立即用于展示，每次访问仍重新读取，避免 TTL 掩盖新用量与跨日变化。
  const flight = Promise.resolve()
    .then(() => service.getAppUsageSnapshot(request))
    .then((snapshot) => {
      entry.snapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      delete entry.inFlight;
      if (!entry.snapshot) entries.delete(key);
      trim(entries);
    });
  entry.inFlight = flight;
  entries.delete(key);
  entries.set(key, entry);
  trim(entries);
  return flight;
}
