import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ApiClient, AppUsageSnapshot } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { getDataBaseDir, setDataBaseDir } from "../src/paths.js";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";

test("cold ACP-only app usage reads native history without a chat runtime or provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-cold-acp-usage-"));
  const previousDir = getDataBaseDir();
  setDataBaseDir(dir);
  const directory = join(dir, "acp-sessions");
  await mkdir(directory, { recursive: true });
  const id = crypto.randomUUID();
  await writeFile(
    join(directory, `${id}.json`),
    JSON.stringify({
      id,
      workspacePath: join(dir, "project"),
      agent: "codex",
      acpSessionId: "fixture-session",
      status: "idle",
      revision: 1,
      title: "Fixture",
      goal: null,
      configOptions: [],
      modeState: null,
      entries: [1, 2, 3].map((turn) => ({
        id: `user:${turn}`,
        kind: "user",
        text: "fixture",
        createdAt: Date.now(),
      })),
      pendingPermission: null,
      error: null,
    }),
  );
  const nativeHistory: AppUsageSnapshot = {
    range: "all",
    timeZone: "Asia/Shanghai",
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
    dailyModelUsage: [],
    models: [],
    tools: [],
  };
  const fixture = join(dir, "native-usage.mjs");
  // 只接受统计 RPC：若读取走了会话创建、provider 同步或认证路径，测试立即失败。
  await writeFile(
    fixture,
    `import { createInterface } from "node:readline";
const history = ${JSON.stringify(nativeHistory)};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const response = request.method === "v4/usage/stats"
    ? { result: { ...history, range: request.params.range, timeZone: request.params.timeZone } }
    : { error: { code: -32601, message: "Unexpected non-usage request" } };
  process.stdout.write(JSON.stringify({ id: request.id, ...response }) + "\\n");
});
`,
  );
  const starts: string[] = [];
  const agentService = createZCodeAgentService({
    requestTimeoutMs: 5_000,
    commandResolver: (context) => {
      starts.push(context.workspacePath);
      return { command: process.execPath, args: [fixture] };
    },
  });
  const acpService = createAcpService({ directory });
  const unexpectedAuth = async (): Promise<never> => {
    throw new Error("App usage must not request authentication");
  };
  const usageService = createUsageStatsService({
    apiClient: {} as ApiClient,
    accountRequestAuthService: {
      resolveAccessCurrent: unexpectedAuth,
      resolveCurrent: unexpectedAuth,
      assertCurrent: unexpectedAuth,
    },
    zcodeAgentService: agentService,
    acpService,
  });
  try {
    const snapshots = await Promise.all(
      ["all", "7d"].map((range) =>
        usageService.getAppUsageSnapshot({
          range: range as "all" | "7d",
          timeZone: "Asia/Shanghai",
        }),
      ),
    );
    assert.deepEqual(starts, [join(dir, ".zcode", "plugin-workspace")]);
    for (const snapshot of snapshots) {
      assert.equal(
        snapshot.summary.totalTokens,
        100,
        "native history must not be replaced by zero",
      );
      assert.equal(snapshot.acpAgents?.[0]?.agent, "codex");
      assert.equal(snapshot.acpAgents?.[0]?.sessions, 1);
      assert.equal(snapshot.acpAgents?.[0]?.turns, 3);
      assert.equal(snapshot.acpAgents?.[0]?.unknownTurns, 3);
    }
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.range),
      ["all", "7d"],
    );
  } finally {
    await Promise.all([agentService.disposeAllAndWait(), acpService.disposeAllAndWait()]);
    setDataBaseDir(previousDir);
    await rm(dir, { recursive: true, force: true });
  }
});
