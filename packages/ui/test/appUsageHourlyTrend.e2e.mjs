// Real AppUsagePanel with synthetic Host snapshots; no user sessions or paid calls.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__usage-hourly-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue131-"));
const hourly = (models) => ({
  date: "2026-10-13",
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    models: hour === 8 || hour === 9 ? models : [],
  })),
});
const snapshot = {
  range: "7d",
  generatedAt: Date.parse("2026-10-13T12:00Z"),
  timeZone: "Asia/Shanghai",
  source: "agent-db",
  summary: {
    totalTokens: 60,
    inputTokens: 60,
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
    peakDayTokens: 60,
    favoriteModel: null,
  },
  heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
  dailyModelUsage: [{ date: "2026-10-13", models: [{ modelId: "small-model", totalTokens: 60 }] }],
  hourlyModelUsage: hourly([{ modelId: "small-model", totalTokens: 30 }]),
  models: [
    {
      modelId: "small-model",
      totalTokens: 60,
      inputTokens: 60,
      outputTokens: 0,
      requestCount: 2,
      share: 1,
    },
  ],
  tools: [],
  acpAgents: [
    {
      agent: "codex",
      sessions: 1,
      turns: 1,
      measuredTurns: 1,
      unknownTurns: 0,
      totalTokens: 20000,
      inputTokens: 20000,
      outputTokens: 0,
      models: [{ modelId: "large-model", totalTokens: 20000, inputTokens: 20000, outputTokens: 0 }],
      hourlyUsage: hourly([{ modelId: "large-model", totalTokens: 10000 }]),
      dailyUsage: [
        { date: "2026-10-13", models: [{ modelId: "large-model", totalTokens: 20000 }] },
      ],
    },
  ],
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
    const params = new URLSearchParams(location.search);
    const snapshot = ${JSON.stringify(snapshot)};
    window.__mode = params.get("mode"); window.__requests = 0;
    const services = { usageStatsService: { getAppUsageSnapshot: async ({range}) => {
      window.__requests++;
      const next = structuredClone(snapshot); next.range = range;
      if (window.__mode === "legacy") { delete next.hourlyModelUsage; delete next.acpAgents[0].hourlyUsage; }
      if (window.__mode === "empty" || window.__mode === "tomorrow") {
        for (const usage of [next.hourlyModelUsage, next.acpAgents[0].hourlyUsage]) {
          for (const hour of usage.hours) hour.models = [];
          if (window.__mode === "tomorrow") usage.date = "2026-10-14";
        }
        if (window.__mode === "tomorrow") next.generatedAt = Date.parse("2026-10-14T12:00Z");
      }
      return next;
    } } };
    createRoot(document.getElementById("root")!).render(
      <ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale={params.get("locale") ?? "zh-CN"}>
        <TooltipProvider><main className="mx-auto max-w-4xl bg-background p-4 text-foreground"><AppUsagePanel /></main></TooltipProvider>
      </ZCodeIntlProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 375])
    for (const theme of ["light", "dark"])
      for (const locale of ["zh-CN", "en-US"]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const url = `${process.env.ZCODE_USAGE_E2E_ORIGIN ?? "http://localhost:5186"}/${name}.html?locale=${locale}`;
        await page.goto(url);
        await page.evaluate((theme) => {
          document.documentElement.className = `${theme} theme-zai-${theme}`;
        }, theme);
        const chart = page.getByTestId("app-usage-hourly-trend");
        const large = chart.getByRole("button", { name: "Codex ACP · large-model", exact: true });
        await large.waitFor();
        await chart.locator(".recharts-bar-rectangle").first().waitFor();
        assert.equal(await chart.getByRole("button").count(), 2);
        assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 4);
        assert.equal(await chart.locator(".recharts-line").count(), 0);
        const daily = page.getByTestId("app-usage-daily-trend");
        await daily.locator(".recharts-line-dot").first().waitFor();
        assert.equal(await daily.locator(".recharts-line").count(), 2);
        assert.equal(await daily.locator(".recharts-bar").count(), 0);
        assert.equal(await chart.getByText("00:00", { exact: true }).count(), 1);
        assert.equal(await chart.getByText("23:00", { exact: true }).count(), 1);
        const ticks = await chart
          .locator(".recharts-xAxis .recharts-cartesian-axis-tick text")
          .evaluateAll((items) =>
            items
              .filter((item) => item.textContent)
              .map((item) => {
                const rect = item.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
              }),
          );
        for (let index = 1; index < ticks.length; index++)
          assert.ok(
            ticks[index].left > ticks[index - 1].right,
            "hour labels must not overlap on mobile",
          );
        const point = await chart.locator(".recharts-bar-rectangle").first().boundingBox();
        await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
        await chart
          .locator(".recharts-tooltip-wrapper")
          .getByText("Codex ACP · large-model", { exact: true })
          .waitFor();
        assert.match(await chart.locator(".recharts-tooltip-wrapper").innerText(), /^08:00 - /);
        const requests = await page.evaluate(() => window.__requests);
        await large.focus();
        await page.keyboard.press("Space");
        assert.equal(await large.getAttribute("aria-pressed"), "false");
        assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 2);
        assert.equal(await page.evaluate(() => window.__requests), requests);
        // 隐藏其它模型后单序列 tooltip 仍必须显示日期与小时。
        const singlePoint = await chart.locator(".recharts-bar-rectangle").first().boundingBox();
        await page.mouse.move(
          singlePoint.x + singlePoint.width / 2,
          singlePoint.y + singlePoint.height / 2,
        );
        await chart
          .locator(".recharts-tooltip-wrapper")
          .getByText("small-model", { exact: true })
          .waitFor();
        assert.match(await chart.locator(".recharts-tooltip-wrapper").innerText(), /^08:00 - /);
        await chart.screenshot({
          path: join(artifacts, `single-hourly-${width}-${theme}-${locale}.png`),
        });
        await chart.getByRole("button", { name: "small-model", exact: true }).click();
        assert.equal(await chart.locator(".recharts-bar").count(), 0);
        await large.click();
        await chart.locator(".recharts-bar-rectangle").first().waitFor();
        const sources = page.getByTestId("app-usage-sources");
        await sources.getByRole("tab", { name: /\/ API$/ }).click();
        assert.equal(await chart.getByRole("button").count(), 1);
        assert.equal(
          await chart.getByRole("button", { name: "small-model" }).getAttribute("aria-pressed"),
          "true",
        );
        await sources.getByRole("tab", { name: "Codex ACP", exact: true }).click();
        assert.equal(await chart.getByRole("button").count(), 1);
        // 独立 ACP 来源本身只有一个模型，复现用户截图中的缺时间场景。
        await chart.locator(".recharts-bar-rectangle").first().waitFor();
        // 来源切换后点坐标可能相同，需要先移开再 hover 新挂载的图表。
        await page.mouse.move(0, 0);
        await chart.locator(".recharts-bar-rectangle").first().hover();
        await chart
          .locator(".recharts-tooltip-wrapper")
          .getByText("Codex ACP · large-model", { exact: true })
          .waitFor();
        assert.match(await chart.locator(".recharts-tooltip-wrapper").innerText(), /^08:00 - /);
        await page
          .getByRole("tab", { name: locale === "zh-CN" ? "近 30 日" : "Last 30 days", exact: true })
          .click();
        await chart.locator(".recharts-bar-rectangle").first().waitFor();
        assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 2);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await chart.screenshot({ path: join(artifacts, `hourly-${width}-${theme}-${locale}.png`) });
        await page.evaluate(() => {
          window.__mode = "tomorrow";
        });
        await page
          .getByRole("button", { name: locale === "zh-CN" ? "刷新" : "Refresh", exact: true })
          .click();
        await chart.getByText("2026-10-14 · Asia/Shanghai", { exact: true }).waitFor();
        assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 0);
        for (const mode of ["legacy", "empty"]) {
          await page.goto(`${url}&mode=${mode}`);
          await chart
            .getByText(
              mode === "legacy"
                ? locale === "zh-CN"
                  ? "当前数据源暂不提供小时统计"
                  : "This data source does not provide hourly usage yet"
                : locale === "zh-CN"
                  ? "还没有可展示的数据"
                  : "No usage data yet",
              { exact: true },
            )
            .waitFor();
          assert.equal(await chart.locator(".recharts-bar-rectangle").count(), 0);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
  process.stdout.write(
    `issues #100/#131: hourly bars, tooltip/legend/source/range/refresh/legacy/empty; desktop/mobile, zh/en, light/dark OK. Artifacts: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
