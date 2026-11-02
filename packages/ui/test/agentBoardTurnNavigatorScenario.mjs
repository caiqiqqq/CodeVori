import assert from "node:assert/strict";
import { join } from "node:path";

// 复用真实看板抽屉与 SessionPane，验证导航无需看板专用状态或跳转逻辑。
export async function exerciseBoardTurnNavigator(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => window.__turnNavigator.view({ board: true }));
  const drawer = page.getByTestId("agent-board-details");
  const rail = drawer.getByTestId("v4-turn-navigator");
  const timeline = drawer.getByTestId("v4-timeline");
  await rail.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-testid="agent-board-details"]').getBoundingClientRect()
          .width - 960,
      ) < 0.1,
  );
  assert.equal(Math.round((await drawer.boundingBox()).width), 960);
  assert.equal(await rail.getAttribute("data-item-count"), "24");
  const first = rail.locator('[data-item-index="0"]');
  await first.hover();
  const preview = page.locator('[data-testid^="v4-turn-navigator-tooltip-"]').filter({
    hasText: "codex question 0",
  });
  await preview.waitFor();
  assert.match(await preview.innerText(), /codex question 0.*codex answer 0/s);
  await first.click();
  await page.waitForFunction(() => {
    const scroll = document.querySelector('[data-testid="v4-timeline"]');
    const row = scroll?.querySelector('[data-row-id="2"]');
    return (
      row && Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 3
    );
  });
  assert.equal(await first.getAttribute("aria-current"), "location");
  await drawer.getByRole("heading", { name: "看板会话", exact: true }).hover();
  await preview.waitFor({ state: "hidden" });
  const geometry = await rail.evaluate((element) => {
    const rail = element.getBoundingClientRect();
    const timeline = element.parentElement.querySelector('[data-testid="v4-timeline"]');
    const content = timeline.querySelector("[data-v4-timeline-content-column]");
    return { right: rail.right, contentLeft: content.getBoundingClientRect().left };
  });
  assert.ok(geometry.contentLeft >= geometry.right - 1, "navigation does not cover messages");
  for (const [theme, name] of [
    ["zai-light", "light"],
    ["zai-dark", "dark"],
  ]) {
    await page.evaluate((theme) => window.__turnNavigator.theme(theme), theme);
    await page.screenshot({ path: join(artifacts, `board-navigator-${name}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await rail.waitFor({ state: "hidden" });
  const container = await drawer.evaluate(
    (element) => element.parentElement.getBoundingClientRect().width,
  );
  const box = await drawer.boundingBox();
  assert.equal(Math.round(box.width), 812);
  assert.ok(container - box.width >= 255, "medium windows retain room for board cards");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await rail.isVisible(), false);
  assert.equal(Math.round((await drawer.boundingBox()).width), 358);
  assert.ok((await timeline.boundingBox()).width <= 358);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "board-navigator-mobile.png") });
  await page.setViewportSize({ width: 1600, height: 900 });
  await rail.waitFor({ state: "visible" });
  await page.evaluate(() => window.__turnNavigator.view({ api: false, share: false }));
  await page.setViewportSize({ width: 1280, height: 800 });
  process.stdout.write(`PASS: board drawer navigation. Screenshots: ${artifacts}\n`);
}
