import assert from "node:assert/strict";
import { join } from "node:path";

// Exercise the real Shell + Sidebar callbacks alongside the existing draft navigation regression.
export async function assertSidebarActionRail({ page, prepare, artifacts }) {
  for (const [width, desktop, locale, theme] of [
    [1440, true, "zh-CN", "zai-light"],
    [1440, true, "en-US", "zai-dark"],
    [390, false, "zh-CN", "zai-dark"],
    [320, false, "en-US", "zai-light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await prepare({ desktop, locale, following: !desktop, view: "chat" });
    await page.evaluate((theme) => window.__newTask.theme(theme), theme);
    const rail = page.getByTestId("workspace-sidebar-action-rail");
    await rail.waitFor();
    const buttons = rail.getByRole("button");
    assert.equal(await buttons.count(), 4);
    const bounds = await rail.boundingBox();
    assert.equal(bounds.width, 48);
    for (const button of await buttons.all()) {
      assert.ok(await button.getAttribute("aria-label"));
      const box = await button.boundingBox();
      assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
      assert.ok(box.y >= 0 && box.y + box.height <= 900);
    }
    const board = await page.getByTestId("agent-board-sidebar-open").boundingBox();
    assert.ok(board.x >= bounds.x + bounds.width, "board stays to the right of the rail");
    if (!desktop) {
      const sidebar = await page.locator("#sidebar").boundingBox();
      assert.ok(sidebar.width >= 264 && sidebar.width <= width - 48);
    }
    assert.equal(await page.getByTestId("task-new-button").count(), 1);

    const search = rail.getByTestId("sidebar-search-open");
    await search.focus();
    const tooltip = page.getByRole("tooltip");
    await tooltip.waitFor();
    assert.ok((await tooltip.textContent()).includes(locale === "zh-CN" ? "搜索" : "Search"));
    assert.ok(await tooltip.locator("kbd").count(), "search shortcut is in the tooltip");
    const searches = await page.evaluate(() => window.__newTask.searches ?? 0);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.__newTask.searches), searches + 1);

    for (const [id, view] of [
      ["automations-open", "automations"],
      ["plugin-store-sidebar-open", "plugin-store"],
    ]) {
      const button = rail.getByTestId(id);
      await button.focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(
        (view) => document.querySelector('[data-testid="navigation"]')?.dataset.view === view,
        view,
      );
      assert.equal(await button.getAttribute("aria-pressed"), "true");
    }
    assert.equal(await rail.getByTestId("automations-open").getAttribute("aria-pressed"), "false");

    await prepare({ desktop, locale, following: !desktop, callback: false });
    const create = rail.getByTestId("task-new-button");
    await create.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__newTask.fallback === 1);
    await prepare({ desktop, locale, following: !desktop, callback: false, readOnly: true });
    // Sidebar 的只读事实来自 tab availability；Shell 的只读原因用于会话区。
    await page.evaluate(() => {
      const store = window.__newTask.tabs;
      store.setState((state) => ({
        tabs: state.tabs.map((tab) => ({ ...tab, availability: "unavailable-local-directory" })),
      }));
    });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="task-new-button"]')?.getAttribute("aria-disabled") ===
        "true",
    );
    assert.ok(await create.isDisabled());
    assert.ok(await search.isEnabled());
    assert.equal(await page.evaluate(() => window.__newTask.fallback), 0);
    await page.mouse.move(width - 10, 850);
    await create.hover();
    const reason = await create.getAttribute("aria-description");
    assert.ok(reason);
    await page.getByRole("tooltip").filter({ hasText: reason }).waitFor();
    await create.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.__newTask.fallback), 0);
    await create.dispatchEvent("click");
    assert.equal(await page.evaluate(() => window.__newTask.fallback), 0);
    await page.evaluate(() => {
      const store = window.__newTask.tabs;
      store.setState((state) => ({
        tabs: state.tabs.map((tab) => ({ ...tab, availability: "available" })),
      }));
    });
    await page.mouse.move(width - 10, 850);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForFunction(() => document.querySelectorAll('[role="tooltip"]').length === 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `action-rail-${width}-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare({ view: "chat", source: "/synthetic/project", callback: false });
  await page.getByTestId("fixture-open-files").click();
  await page.getByTestId("fixture-files").waitFor();
  const rail = page.getByTestId("workspace-sidebar-action-rail");
  const searches = await page.evaluate(() => window.__newTask.searches ?? 0);
  await rail.getByTestId("sidebar-search-open").click();
  assert.equal(await page.evaluate(() => window.__newTask.searches), searches + 1);
  assert.equal(await page.getByTestId("top-new-task-state").getAttribute("data-visible"), "false");
  await page.getByRole("button", { name: "Back to tasks" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="fixture-files"]')
        ?.closest("[aria-hidden]")
        ?.getAttribute("aria-hidden") === "true",
  );
  await page.getByRole("tab").first().click();
  await page.getByTestId("fixture-grouped").waitFor();
  await rail.getByTestId("task-new-button").click();
  await page.waitForFunction(() => window.__newTask.grouped === 1);
  assert.equal(await page.evaluate(() => window.__newTask.fallback), 0);
}
