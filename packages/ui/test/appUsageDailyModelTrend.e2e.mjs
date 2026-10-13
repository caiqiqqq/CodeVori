// Isolated real AppUsagePanel, with issue #87's large/small-model imbalance.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__usage-trend-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue87-"));
const ids = ["Codex ACP · gpt", "GLM-5.3", ...Array.from({ length: 6 }, (_, i) => `small-${i}`)];
const snapshot = {
  range: "7d",
  generatedAt: Date.UTC(2026, 9, 12, 8),
  timeZone: "Asia/Shanghai",
  source: "agent-db",
  summary: {
    totalTokens: 40_200_000,
    inputTokens: 40_200_000,
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
    activeDays: 3,
    currentStreakDays: 3,
    longestSessionMs: 0,
    longestStreakDays: 3,
    peakDayTokens: 40_000_000,
    favoriteModel: null,
  },
  heatmap: { startDate: "2026-10-10", endDate: "2026-10-12", maxTokens: 0, weeks: [] },
  dailyModelUsage: [
    { date: "2026-10-10", models: ids.map((modelId) => ({ modelId, totalTokens: 20_000 })) },
    { date: "2026-10-11", models: [{ modelId: "GLM-5.3", totalTokens: 40_000 }] },
    {
      date: "2026-10-12",
      models: [
        { modelId: ids[0], totalTokens: 40_000_000 },
        { modelId: "GLM-5.3", totalTokens: 0 },
      ],
    },
  ],
  models: ids.map((modelId, i) => ({
    modelId,
    totalTokens: i === 0 ? 40_020_000 : i === 1 ? 60_000 : 20_000,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 1,
    share: 0,
  })),
  tools: [],
  acpAgents: [],
};
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { AppUsagePanel } from "../../../ui/src/settings/usage-stats/AppUsagePanel.tsx";
    import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
    import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
    import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
    import "../../../ui/src/styles.css";
    const snapshot = ${JSON.stringify(snapshot)};
    window.__usageRequests = 0;
    const services = { usageStatsService: { getAppUsageSnapshot: async ({range}) => {
      window.__usageRequests++; return {...snapshot, range};
    } } };
    createRoot(document.getElementById("root")!).render(
      <ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN">
        <TooltipProvider><main className="mx-auto max-w-4xl bg-background p-4 text-foreground"><AppUsagePanel /></main></TooltipProvider>
      </ZCodeIntlProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${process.env.ZCODE_USAGE_E2E_ORIGIN ?? "http://localhost:5174"}/${name}.html`,
      );
      await page.evaluate((theme) => {
        document.documentElement.className = `${theme} theme-zai-${theme}`;
      }, theme);
      const trend = page.getByTestId("app-usage-daily-trend");
      await trend.getByRole("button", { name: "small-5", exact: true }).waitFor();
      assert.equal(await trend.getByRole("button").count(), 8);
      const lines = trend.locator(".recharts-line");
      await trend.locator(".recharts-line-dot").first().waitFor();
      const dots = trend.locator(".recharts-line-dots");
      // Today has only a Codex point. Neither explicit zero GLM nor missing small models draw dots.
      assert.equal(await dots.nth(1).locator(".recharts-line-dot").count(), 2);
      assert.equal(await dots.nth(2).locator(".recharts-line-dot").count(), 1);
      // 小时图位于每日图上方；先滚动到绘图区再使用页面坐标 hover。
      await trend.scrollIntoViewIfNeeded();
      const today = await dots.first().locator(".recharts-line-dot").last().boundingBox();
      await page.mouse.move(today.x + today.width / 2, today.y + today.height / 2);
      await page.waitForFunction(
        () => document.querySelectorAll(".recharts-active-dot circle").length === 1,
      );
      assert.equal(await trend.locator(".recharts-active-dot circle").count(), 1);
      const tooltipText = await trend.locator(".recharts-tooltip-wrapper").innerText();
      assert.match(tooltipText, /10月12日/, "single active daily model must retain the date title");
      assert.equal(tooltipText.includes("GLM-5.3"), false);
      assert.equal(tooltipText.includes("Codex ACP · gpt"), true);
      const requests = await page.evaluate(() => window.__usageRequests);
      const smallBefore = await lines
        .nth(1)
        .locator(".recharts-line-curve")
        .evaluate((path) => path.getBBox().height);
      await trend.getByRole("button", { name: ids[0], exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="app-usage-daily-trend"] .recharts-line')
            .length === 7,
      );
      const smallAfter = await lines
        .first()
        .locator(".recharts-line-curve")
        .evaluate((path) => path.getBBox().height);
      assert.ok(
        smallAfter > smallBefore * 100,
        "small-model curve must rescale after hiding Codex",
      );
      assert.equal(await page.evaluate(() => window.__usageRequests), requests);
      // All-off must leave the controls available, including the formerly truncated eighth model.
      for (const id of ids.slice(1))
        await trend.getByRole("button", { name: id, exact: true }).click();
      assert.equal(await trend.locator(".recharts-line").count(), 0);
      await trend.getByRole("button", { name: "small-5", exact: true }).click();
      await trend.locator(".recharts-line-dot").waitFor();
      const sources = page.getByTestId("app-usage-sources");
      await sources.getByRole("tab", { name: /\/ API$/ }).click();
      assert.equal(await trend.locator('button[aria-pressed="true"]').count(), 8);
      // Keyboard operates the same legend; changing range restores all visible.
      await trend.getByRole("button", { name: ids[0], exact: true }).focus();
      await page.keyboard.press("Space");
      assert.equal(
        await trend.getByRole("button", { name: ids[0], exact: true }).getAttribute("aria-pressed"),
        "false",
      );
      await page.getByRole("tab", { name: "近 30 日", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="app-usage-daily-trend"] button[aria-pressed="true"]',
          ).length === 8,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await trend.screenshot({ path: join(artifacts, `trend-${width}-${theme}.png`) });
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    `issue #87: zero points, small-model scale, eight models, keyboard, range/source resets, desktop/mobile themes OK. Artifacts: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
