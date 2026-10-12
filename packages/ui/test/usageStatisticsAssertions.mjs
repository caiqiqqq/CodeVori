import assert from "node:assert/strict";

export async function assertUsageChartPresentation({
  page,
  acpCharts,
  activity,
  width,
  nativeLabelStyle,
}) {
  const fullRing = await acpCharts
    .locator(".recharts-pie-sector path")
    .first()
    .evaluate((path) => {
      const bounds = path.getBBox();
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      const radius = bounds.width * 0.4;
      return Array.from({ length: 24 }, (_, index) => ((index + 0.5) * Math.PI) / 12).every(
        (angle) =>
          path.isPointInFill(
            new DOMPoint(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius),
          ),
      );
    });
  assert.equal(fullRing, true, "single-model 100% usage must display a complete ring immediately");
  const acpLabelStyle = await page
    .getByTestId("app-usage-agent-detail-codex")
    .getByText("累计 Token 数", { exact: true })
    .evaluate((element) => ({
      size: getComputedStyle(element).fontSize,
      align: getComputedStyle(element).textAlign,
    }));
  assert.deepEqual(acpLabelStyle, nativeLabelStyle);
  assert.equal(acpLabelStyle.align, "center");
  const separators = page
    .getByTestId("app-usage-agent-detail-codex")
    .locator('[aria-hidden="true"]');
  assert.equal(await separators.count(), 4);
  assert.equal(await separators.first().isVisible(), width >= 640);
  const legendFonts = await acpCharts
    .getByRole("listitem")
    .filter({ hasText: "Codex ACP · gpt-codex" })
    .evaluateAll((items) =>
      items.map(
        (item) =>
          getComputedStyle(
            [...item.querySelectorAll("span")].find(
              (span) => span.textContent === "Codex ACP · gpt-codex",
            ),
          ).fontFamily,
      ),
    );
  assert.equal(legendFonts.length, 2);
  assert.equal(legendFonts[0], legendFonts[1]);
  assert.equal(
    await acpCharts
      .locator(".recharts-line-curve")
      .first()
      .evaluate(
        (path) =>
          path.getBBox().width > 0 ||
          !!path.closest(".recharts-wrapper")?.querySelector(".recharts-line-dot"),
      ),
    true,
    "dated usage must display its complete trend immediately",
  );
  const cardPadding = await activity.evaluate((element) => getComputedStyle(element).paddingLeft);
  const trendPadding = await acpCharts
    .getByRole("heading", { name: "每日 Token 趋势图" })
    .evaluate((element) => getComputedStyle(element.parentElement).paddingLeft);
  assert.equal(cardPadding, trendPadding);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "statistics must not overflow mobile width",
  );
}
