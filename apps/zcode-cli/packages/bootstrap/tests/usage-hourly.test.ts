import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { queryAppUsage } from "../../adapters/src/storage/session-store/repositories/usage.js";
import { SQLITE_MIGRATIONS } from "../../adapters/src/storage/session-store/migrations.js";
import {
  buildAppUsageSnapshot,
  resolveTzOffsetMs,
} from "../src/zcode-protocol/usage-stats-builder.js";

test("SQLite usage facts survive query → builder → schema without changing daily stats", async () => {
  const db = new DatabaseSync(":memory:");
  const until = Date.parse("2026-10-13T12:00Z");
  const timeZone = "Asia/Shanghai";
  const tzOffsetMs = resolveTzOffsetMs(timeZone, until);
  const times = [
    "2026-10-12T15:59:59Z",
    "2026-10-12T16:00Z",
    "2026-10-12T16:30Z",
    "2026-10-13T12:00:01Z",
  ];
  try {
    db.exec(
      "create table session(id text primary key); insert into session(id) values ('fixture')",
    );
    const migration = SQLITE_MIGRATIONS.find((item) =>
      item.sql.includes("create table if not exists model_usage"),
    );
    assert.ok(migration);
    db.exec(migration.sql);
    for (const [index, at] of times.entries())
      db.prepare(`insert into model_usage
        (id, logical_request_id, session_id, query_source, provider_id, model_id, status, started_at, computed_total_tokens)
        values (?, ?, 'fixture', 'main_turn', 'fixture', 'model', 'completed', ?, 10)`).run(
        String(index),
        String(index),
        Date.parse(at),
      );
    for (const range of ["all", "7d", "30d"] as const) {
      const since = range === "all" ? 0 : until - (range === "7d" ? 7 : 30) * 86_400_000;
      const result = await queryAppUsage(db, { since, until, tzOffsetMs });
      assert.equal(result.totals.totalTokens, 30);
      assert.equal(result.recentModelUsage?.length, 3);
      const value = appUsageSnapshotSchema.parse(
        buildAppUsageSnapshot(result, {
          range,
          since,
          until,
          generatedAt: until,
          timeZone,
          tzOffsetMs,
        }),
      );
      assert.equal(value.hourlyModelUsage?.date, "2026-10-13");
      assert.deepEqual(value.hourlyModelUsage?.hours[0]?.models, [
        { modelId: "model", totalTokens: 20 },
      ]);
      assert.deepEqual(value.dailyModelUsage.find((day) => day.date === "2026-10-13")?.models, [
        { modelId: "model", totalTokens: 20 },
      ]);
      const legacy = { ...result, recentModelUsage: undefined };
      assert.equal(
        buildAppUsageSnapshot(legacy, {
          range,
          since,
          until,
          generatedAt: until,
          timeZone,
          tzOffsetMs,
        }).hourlyModelUsage,
        undefined,
      );
    }
  } finally {
    db.close();
  }
});
