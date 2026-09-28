// Isolated renderer fixture: verifies the real usage panel without reading or changing user sessions.
// Run while the desktop Vite server (5174) is available.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const rendererRoot = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-usage-e2e-${process.pid}`;
const html = join(rendererRoot, `${name}.html`);
const moduleFile = join(rendererRoot, `${name}.tsx`);

function snapshot(range, nativeTokens, agents) {
  return {
    range,
    generatedAt: Date.now(),
    timeZone: "Asia/Shanghai",
    source: "agent-db",
    summary: {
      totalTokens: nativeTokens,
      inputTokens: nativeTokens,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 1,
      totalTurns: 1,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: null,
      avgTurnDurationMs: null,
      activeDays: 1,
      currentStreakDays: 1,
      longestSessionMs: 0,
      longestStreakDays: 1,
      peakDayTokens: nativeTokens,
      favoriteModel: null,
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
    dailyModelUsage: [],
    models: [
      {
        modelId: "glm",
        totalTokens: nativeTokens,
        inputTokens: nativeTokens,
        outputTokens: 0,
        requestCount: 1,
        share: 1,
      },
    ],
    tools: [],
    acpAgents: agents,
  };
}

function agent(id, turns, measured, tokens, model) {
  return {
    agent: id,
    sessions: 1,
    turns,
    measuredTurns: measured,
    unknownTurns: turns - measured,
    totalTokens: tokens,
    inputTokens: tokens,
    outputTokens: 0,
    models: model
      ? [{ modelId: model, totalTokens: tokens, inputTokens: tokens, outputTokens: 0 }]
      : [],
  };
}

const snapshots = {
  all: snapshot("all", 100, [
    agent("claude", 2, 1, 42, "claude-sonnet"),
    agent("codex", 3, 0, 0),
    agent("gemini", 1, 0, 0),
    agent("opencode", 1, 0, 0),
    agent("qoder", 1, 0, 0),
    agent("openclaw", 1, 0, 0),
    agent("cline", 1, 0, 0),
    agent("hermes", 1, 0, 0),
    agent("codebuddy", 1, 0, 0),
    agent("kimi-code", 1, 0, 0),
    agent("pi", 1, 0, 0),
    agent("grok", 1, 0, 0),
    agent("cursor", 1, 0, 0),
    agent("deepseek", 1, 0, 0),
    agent("antigravity", 1, 0, 0),
  ]),
  "7d": snapshot("7d", 20, [agent("claude", 1, 1, 12, "claude-haiku")]),
  "30d": snapshot("30d", 70, [agent("claude", 1, 1, 30, "claude-sonnet"), agent("codex", 1, 0, 0)]),
};

let browser;
let page;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { AppUsagePanel } from "../../../ui/src/settings/usage-stats/AppUsagePanel.tsx";
      import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import "../../../ui/src/styles.css";
      const snapshots = ${JSON.stringify(snapshots)};
      window.__usageRequests = [];
      const services = { usageStatsService: {
        getAppUsageSnapshot: async ({ range }) => {
          window.__usageRequests.push(range);
          return snapshots[range];
        },
      } };
      createRoot(document.getElementById("root")!).render(
        <ServiceProvider services={services as never}>
          <ZCodeIntlProvider initialLocale="zh-CN"><AppUsagePanel /></ZCodeIntlProvider>
        </ServiceProvider>,
      );
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(`http://localhost:5174/${name}.html`);
  const sources = page.locator('[data-testid="app-usage-sources"]');
  await sources.getByRole("tab", { name: "Claude" }).waitFor();
  await sources.getByRole("tab", { name: "Codex" }).waitFor();
  assert.equal(await page.locator('[data-testid="app-usage-native-charts"]').count(), 1);
  assert.equal(await page.locator('[data-testid="app-usage-native-summary"]').count(), 1);
  assert.equal(
    await page.locator('[data-testid="app-usage-source-overview"]').count(),
    0,
    "all sources should open the native charts without a duplicate source card",
  );
  await sources.getByRole("tab", { name: "Claude" }).click();
  await page
    .locator('[data-testid="app-usage-agent-detail-claude"]')
    .getByText("claude-haiku")
    .waitFor();
  assert.equal(await page.locator('[data-testid="app-usage-native-charts"]').count(), 0);
  await page.getByRole("tab", { name: "全部时间" }).click();
  await page
    .locator('[data-testid="app-usage-agent-detail-claude"]')
    .getByText("claude-sonnet")
    .waitFor();
  await sources.getByRole("tab", { name: "Codex" }).click();
  const codex = page.locator('[data-testid="app-usage-agent-detail-codex"]');
  await codex.getByText("当前 Codex ACP 适配器只报告最后一次模型请求", { exact: false }).waitFor();
  assert.equal(await codex.locator('[data-testid="app-usage-acp-models"]').count(), 0);
  await page.getByRole("tab", { name: "近 7 日" }).click();
  await codex.getByText("0", { exact: true }).first().waitFor();
  await sources.getByRole("tab", { name: "ZCode / API" }).click();
  assert.equal(await page.locator('[data-testid="app-usage-native-charts"]').count(), 1);
  await page.getByRole("tab", { name: "近 30 日" }).click();
  await page
    .locator('[data-testid="app-usage-native-charts"]')
    .getByText("glm", { exact: true })
    .waitFor();
  await sources.getByRole("tab", { name: "全部来源" }).click();
  assert.equal(await page.locator('[data-testid="app-usage-source-overview"]').count(), 0);
  assert.equal(await page.locator('[data-testid="app-usage-native-charts"]').count(), 1);
  assert.equal(await sources.getByRole("tab", { name: "Codex" }).count(), 1);
  await page.setViewportSize({ width: 375, height: 812 });
  const contained = await sources.evaluate((element) => {
    const list = element.querySelector('[role="tablist"]').getBoundingClientRect();
    return [...element.querySelectorAll('[role="tab"]')].every((tab) => {
      const bounds = tab.getBoundingClientRect();
      return bounds.bottom <= list.bottom + 1 && bounds.right <= window.innerWidth;
    });
  });
  assert.equal(contained, true, "source tabs must fit their wrapping container on mobile");
  assert.deepEqual(await page.evaluate(() => window.__usageRequests), [
    "all",
    "7d",
    "all",
    "7d",
    "30d",
  ]);
  await page.setViewportSize({ width: 320, height: 812 });
  await page.getByRole("tab", { name: "全部时间" }).click();
  const summary = page.locator('[data-testid="app-usage-lifetime-summary"]');
  assert.equal(await summary.count(), 1, "the overall summary remains visible");
  assert.equal(await page.locator('[data-testid="app-usage-source-overview"]').count(), 0);
  const lastAgent = sources.getByRole("tab", { name: "Google Antigravity" });
  await lastAgent.click();
  await page.locator('[data-testid="app-usage-agent-detail-antigravity"]').waitFor();
  const containedAt320 = await sources.evaluate((element) => {
    const width = element.getBoundingClientRect().width;
    return element.scrollWidth <= width + 1;
  });
  assert.equal(containedAt320, true, "agent source tabs must not overflow mobile width");
  await sources.getByRole("tab", { name: "全部来源" }).click();
  assert.equal(await page.locator('[data-testid="app-usage-native-charts"]').count(), 1);
  process.stdout.write("ACP usage source switching, range, unknown and native charts: OK\n");
} finally {
  await page?.close();
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
