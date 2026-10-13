import type { DatabaseSync } from "node:sqlite";
import type { AppUsageQueryInput, AppUsageQueryResult } from "@zcode/contracts";

const HOURLY_USAGE_LOOKBACK_MS = 2 * 86_400_000;

/** Bounded facts for IANA timezone projection; daily aggregates remain in the existing query. */
export function queryRecentModelUsage(db: DatabaseSync, { since, until }: AppUsageQueryInput) {
  return db
    .prepare(
      `select started_at as startedAt, model_id as modelId, computed_total_tokens as totalTokens
     from model_usage where started_at >= ? and started_at <= ?`,
    )
    .all(Math.max(since, until - HOURLY_USAGE_LOOKBACK_MS), until) as NonNullable<
    AppUsageQueryResult["recentModelUsage"]
  >;
}
