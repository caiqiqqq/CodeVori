import assert from "node:assert/strict";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskWorkspaceTools(page, panel, card, artifacts) {
  const before = await page.evaluate(() => window.__tasks.calls);
  for (const [kind, id, title] of [
    ["api", "task-0", "API task"],
    ["acp", "task-1", "ACP task"],
  ]) {
    await card(id).getByRole("button", { name: title, exact: true }).click();
    const path = `/synthetic/trees/${id}/project`;
    await assertWorkTaskSessionTarget(panel, kind, `session-${id}`, path);
    const header = panel.getByTestId("work-task-content").locator(":scope > header");
    const session = await panel.getByTestId("work-task-fixture-session").elementHandle();
    const draft = panel.getByRole("textbox", { name: "Synthetic conversation draft", exact: true });
    await draft.fill("工具操作保留草稿");
    assert.equal((await page.evaluate(() => window.__tasks.toolTarget)).workspacePath, path);
    await header.getByRole("button", { name: "在 Finder 中打开", exact: true }).click();
    await header.getByRole("button", { name: "选择打开方式", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /VS Code/ }).click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await header.getByRole("button", { name: "在 VS Code 中打开", exact: true }).click();
    await header.getByRole("button", { name: "选择打开方式", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /Finder/ }).click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await header.getByTestId("terminal-toggle").click();
    await header.getByTestId("side-pane-toggle").click();
    const calls = await page.evaluate(() => window.__tasks.toolCalls);
    for (const editor of ["finder", "vscode"])
      assert.equal(
        calls.findLast((call) => call.op === "editor" && call.editor === editor).path,
        path,
      );
    for (const op of ["terminal", "side-pane"])
      assert.equal(calls.findLast((call) => call.op === op).target.workspacePath, path);
    assert.equal(await draft.inputValue(), "工具操作保留草稿");
    assert.equal(await page.evaluate((element) => element.isConnected, session), true);
    await session.dispose();
  }
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls),
    before,
    "tools must not write tasks or agents",
  );
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
      await page.evaluate((name) => {
        document.documentElement.className = name;
      }, theme);
      await page.screenshot({
        path: `${artifacts}/tools-${width}-${theme.startsWith("dark") ? "dark" : "light"}.png`,
      });
      const overflow = await panel
        .getByTestId("work-task-content")
        .evaluate((element) => element.scrollWidth > element.clientWidth);
      assert.equal(overflow, false, "task header tools must fit the conversation width");
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await panel.getByRole("button", { name: "关闭任务查看", exact: true }).click();
  await panel.getByTestId("work-task-no-selection").waitFor();
  assert.equal(await page.evaluate(() => window.__tasks.toolTarget), null);
  assert.equal(await panel.getByTestId("work-task-workspace-tools").count(), 0);
  await card("task-1").getByRole("button", { name: "ACP task", exact: true }).click();
}
