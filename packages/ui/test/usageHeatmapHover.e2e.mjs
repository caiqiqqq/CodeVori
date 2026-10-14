// Issue #125: exercise real heatmap tooltips with physical pointer movement.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__usage-hover-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue125-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><style>*,::before,::after{animation:none!important;transition:none!important}</style><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { UsageHeatmap } from "../../../ui/src/settings/usage-stats/UsageHeatmap.tsx";
    import { ZCodeIntlProvider, useZCodeIntl } from "../../../ui/src/i18n/IntlProvider.tsx";
    import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
    import "../../../ui/src/styles.css";
    const days = Array.from({length: 14}, (_, index) => ({
      date: "2026-10-" + String(index + 4).padStart(2, "0"),
      level: index === 4 ? 4 : 0,
      totalTokens: index === 4 ? 342 : 0,
      turnCount: 0, toolCallCount: 0,
    }));
    function Fixture() {
      const {locale, intl} = useZCodeIntl();
      return <main className="mx-auto max-w-4xl bg-background p-4 text-foreground">
        <UsageHeatmap locale={locale} intl={intl} weeks={[{weekIndex: 0, days}]} countMetric="tokens" />
      </main>;
    }
    createRoot(document.getElementById("root")!).render(
      <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider>);
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
      const activity = page.getByTestId("usage-token-activity");
      // Radix 的关闭动画会短暂保留旧 DOM，只检查当前打开的提示。
      const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])');
      const cell = (key) => activity.locator(`[data-usage-heatmap-cell="${key}"]`);
      async function moveToCell(key) {
        const bounds = await cell(key).boundingBox();
        assert.ok(bounds);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      }
      async function expectTooltip(date, tokens) {
        await tooltip.filter({ hasText: date }).waitFor({ timeout: 5000 });
        assert.equal(await tooltip.count(), 1);
        assert.ok((await tooltip.innerText()).includes(`${tokens} tokens`));
      }
      try {
        await cell("daily-2026-10-15").waitFor();
        await moveToCell("daily-2026-10-15");
        await expectTooltip("2026年10月15日", 0);
        await moveToCell("daily-2026-10-08");
        await expectTooltip("2026年10月8日", 342);

        // 指针移向旧浮层覆盖的格子时也必须命中新格子，而非停留在旧提示上。
        const coveredKey = await tooltip.evaluate((content) => {
          const rect = content.getBoundingClientRect();
          return Array.from(document.querySelectorAll("[data-usage-heatmap-cell]"))
            .find((element) => {
              const cell = element.getBoundingClientRect();
              const x = cell.x + cell.width / 2;
              const y = cell.y + cell.height / 2;
              return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
            })
            ?.getAttribute("data-usage-heatmap-cell");
        });
        assert.ok(coveredKey, "fixture must exercise a cell underneath the open tooltip");
        const coveredDate = new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${coveredKey.slice(6)}T00:00:00Z`));
        await moveToCell(coveredKey);
        await expectTooltip(coveredDate, 0);
        await page.mouse.move(0, 900, { steps: 10 });
        await tooltip.waitFor({ state: "hidden" });

        for (const [mode, label, firstTokens] of [
          ["weekly", "每周", 0],
          ["cumulative", "累计", 342],
        ]) {
          await activity.getByRole("tab", { name: label, exact: true }).click();
          await moveToCell(`${mode}-2026-10-15`);
          await expectTooltip("2026年10月17日", firstTokens);
          await moveToCell(`${mode}-2026-10-08`);
          await expectTooltip("2026年10月10日", 342);
          await page.mouse.move(0, 900, { steps: 10 });
          await tooltip.waitFor({ state: "hidden" });
        }
        await activity.getByRole("tab", { name: "每日", exact: true }).click();
        await moveToCell("daily-2026-10-08");
        await expectTooltip("2026年10月8日", 342);
        await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
        assert.deepEqual(errors, []);
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `failed-${width}-${theme}.png`) });
        process.stderr.write(
          JSON.stringify(
            await page.evaluate(() => ({
              hovered: Array.from(document.querySelectorAll(":hover")).map((node) => ({
                tag: node.tagName,
                cell: node.getAttribute("data-usage-heatmap-cell"),
                popper: node.hasAttribute("data-radix-popper-content-wrapper"),
              })),
            })),
          ) + "\n",
        );
        process.stderr.write(`Failure artifacts: ${artifacts}\n`);
        throw error;
      } finally {
        await page.close();
      }
    }
  }
  process.stdout.write(`Heatmap continuous hover desktop/mobile light/dark: OK. ${artifacts}\n`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
