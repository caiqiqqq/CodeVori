import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient, AppUsageSnapshot } from "@zcode/shared";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

test("app usage joins native and ACP facts for the same range without replacing native model charts", async () => {
  const request = { range: "7d" as const, timeZone: "Asia/Shanghai" };
  const native: AppUsageSnapshot = {
    ...request,
    generatedAt: 123,
    source: "agent-db",
    summary: {
      totalTokens: 100,
      inputTokens: 70,
      outputTokens: 30,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 1,
      totalTurns: 2,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 1,
      currentStreakDays: 1,
      longestSessionMs: 0,
      longestStreakDays: 1,
      peakDayTokens: 100,
      favoriteModel: null,
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
    dailyModelUsage: [{ date: "2026-09-28", models: [{ modelId: "glm", totalTokens: 100 }] }],
    models: [
      {
        modelId: "glm",
        totalTokens: 100,
        inputTokens: 70,
        outputTokens: 30,
        requestCount: 2,
        share: 1,
      },
    ],
    tools: [],
  };
  const acpAgents = [
    {
      agent: "claude" as const,
      sessions: 1,
      turns: 2,
      measuredTurns: 1,
      unknownTurns: 1,
      totalTokens: 42,
      inputTokens: 32,
      outputTokens: 10,
      models: [{ modelId: "claude-sonnet", totalTokens: 42, inputTokens: 32, outputTokens: 10 }],
    },
  ];
  const calls: string[] = [];
  const service = createUsageStatsService({
    apiClient: {} as ApiClient,
    accountRequestAuthService: {
      resolveAccessCurrent: async () => {
        throw new Error("unrelated auth query");
      },
      resolveCurrent: async () => {
        throw new Error("unrelated auth query");
      },
      assertCurrent: async () => {
        throw new Error("unrelated auth query");
      },
    },
    zcodeAgentService: {
      getAppUsageStats: async (input) => {
        assert.deepEqual(input, request);
        calls.push("native");
        return native;
      },
    },
    acpService: {
      getUsageStats: async (input) => {
        assert.deepEqual(input, request);
        calls.push("acp");
        return acpAgents;
      },
    },
  });

  const combined = appUsageSnapshotSchema.parse(await service.getAppUsageSnapshot(request));
  assert.deepEqual(calls.sort(), ["acp", "native"]);
  assert.deepEqual(combined.acpAgents, acpAgents);
  assert.equal(combined.summary.totalTokens, 100);
  assert.deepEqual(combined.models, native.models);
  assert.deepEqual(combined.dailyModelUsage, native.dailyModelUsage);
});
