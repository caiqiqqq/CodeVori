import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardLayoutModes(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const switcher = page.getByRole("group", { name: "布局方式", exact: true });
  const cards = page.locator("[data-board-card]");
  const initialKeys = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.boardCard),
  );
  const firstCardHeight = (await cards.first().boundingBox()).height;
  assert.equal(
    await switcher.getByRole("button", { name: "卡片", exact: true }).getAttribute("aria-pressed"),
    "true",
  );

  await switcher.getByRole("button", { name: "紧凑", exact: true }).click();
  assert.deepEqual(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardCard)),
    initialKeys,
  );
  assert.ok(
    (await cards.first().boundingBox()).height < firstCardHeight,
    "compact cards use less height",
  );
  await page.screenshot({
    path: join(artifacts, "layout-compact-desktop.png"),
    animations: "disabled",
  });

  await switcher.getByRole("button", { name: "列表", exact: true }).click();
  assert.deepEqual(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardCard)),
    initialKeys,
  );
  const first = await cards.first().boundingBox();
  const second = await cards.nth(1).boundingBox();
  assert.ok(
    first.width > 600 && first.height < firstCardHeight,
    "list rows use the available width",
  );
  assert.ok(second.y > first.y, "list rows stack vertically");
  await cards
    .filter({ has: page.getByRole("heading", { name: "Remote API session", exact: true }) })
    .getByRole("button", { name: /Remote API session/ })
    .click();
  await page.getByTestId("agent-board-details").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("agent-board-details").waitFor({ state: "hidden" });
  await page.screenshot({
    path: join(artifacts, "layout-list-desktop.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "layout-list-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1600, height: 1000 });

  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  assert.equal(
    await switcher.getByRole("button", { name: "列表", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("zcode-agent-board:v1")).layoutMode),
    "list",
  );
  await switcher.getByRole("button", { name: "卡片", exact: true }).click();
  assert.equal(
    await switcher.getByRole("button", { name: "卡片", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
}
