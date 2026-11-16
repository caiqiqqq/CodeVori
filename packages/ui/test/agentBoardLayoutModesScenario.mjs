import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardLayoutModes(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const switcher = page.getByRole("group", { name: "布局方式", exact: true });
  const cards = page.locator("[data-board-card]");
  const initialKeys = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.boardCard),
  );
  const firstCardBox = await cards.first().boundingBox();
  const columns = () =>
    page.locator("[data-board-column]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width } = node.getBoundingClientRect();
        return { key: node.dataset.boardColumn, x, y, width };
      }),
    );
  const cardColumns = await columns();
  const selectedLayout = async (mode) => {
    const selected = switcher.getByRole("button", { name: mode, exact: true });
    assert.equal(await selected.getAttribute("aria-pressed"), "true");
    assert.equal(await switcher.locator("button[aria-pressed=true]").count(), 1);
    const selectedClasses = await selected.getAttribute("class");
    assert.match(selectedClasses, /border-brand/);
    assert.match(selectedClasses, /bg-brand/);
    assert.match(selectedClasses, /text-foreground-inverse/);
    const unselectedClasses = await switcher
      .getByRole("button", { name: mode === "卡片" ? "紧凑" : "卡片", exact: true })
      .getAttribute("class");
    assert.doesNotMatch(unselectedClasses, /(?:^|\s)bg-brand(?:\s|$)/);
  };
  assert.equal(
    await switcher.getByRole("button", { name: "卡片", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await selectedLayout("卡片");

  await switcher.getByRole("button", { name: "紧凑", exact: true }).click();
  await selectedLayout("紧凑");
  assert.deepEqual(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardCard)),
    initialKeys,
  );
  assert.deepEqual(await columns(), cardColumns, "compact keeps the horizontal card-column layout");
  const compactCardBox = await cards.first().boundingBox();
  assert.ok(compactCardBox.width <= 224, "compact cards stay small-card width");
  assert.ok(compactCardBox.width < firstCardBox.width - 24, "compact cards are visibly narrower");
  assert.ok(compactCardBox.height < firstCardBox.height, "compact cards use less height");
  const runningCards = page.locator('[data-board-column="running"] [data-board-card]');
  const firstCompact = await runningCards.nth(0).boundingBox();
  const secondCompact = await runningCards.nth(1).boundingBox();
  assert.ok(
    Math.abs(firstCompact.y - secondCompact.y) < 2 && secondCompact.x > firstCompact.x,
    "compact cards use multiple columns inside a wide status group",
  );
  await page.screenshot({
    path: join(artifacts, "layout-compact-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok((await cards.first().boundingBox()).width <= 224, "mobile compact cards stay small");
  await page.screenshot({
    path: join(artifacts, "layout-compact-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1600, height: 1000 });

  await switcher.getByRole("button", { name: "列表", exact: true }).click();
  await selectedLayout("列表");
  assert.deepEqual(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardCard)),
    initialKeys,
  );
  const listColumns = await page.locator("[data-board-column]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y } = node.getBoundingClientRect();
      return { key: node.dataset.boardColumn, x, y };
    }),
  );
  assert.deepEqual(
    listColumns.map(({ key }) => key),
    ["running", "completed", "staged", "error"],
  );
  assert.ok(
    listColumns[1].x > listColumns[0].x && Math.abs(listColumns[1].y - listColumns[0].y) < 2,
    "list status groups stay side by side",
  );
  const first = await cards.first().boundingBox();
  const second = await cards.nth(1).boundingBox();
  assert.ok(
    first.width >= 250 && first.width <= 400 && first.height < firstCardBox.height,
    "list rows fit within a horizontal status column",
  );
  assert.ok(
    (await cards
      .first()
      .locator("h3")
      .evaluate((node) => node.clientWidth)) >= 90,
    "list rows keep enough width for the item title",
  );
  assert.ok(second.y > first.y, "list rows stack vertically");
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="agent-board-columns"]');
    if (container) container.scrollTop = 0;
  });
  await page.screenshot({
    path: join(artifacts, "layout-list-desktop.png"),
    animations: "disabled",
  });
  await cards
    .filter({ has: page.getByRole("heading", { name: "Remote API session", exact: true }) })
    .getByRole("button", { name: /Remote API session/ })
    .click();
  await page.getByTestId("agent-board-details").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("agent-board-details").waitFor({ state: "hidden" });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "layout-list-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1600, height: 1000 });

  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await selectedLayout("列表");
  }
  await page.evaluate(() => (document.documentElement.className = "theme-zai-light"));

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
