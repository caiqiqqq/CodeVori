import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardStaging(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, {
      liveStatus: "completed",
      updatedAt: 4000,
      activity: { phase: "completedSuccess", hasBackgroundWork: false },
    });
    f.updateAcp(0, { status: "idle" });
    f.updateAcp(1, { status: "interrupted" });
    const s = f.store.getState();
    s.selectProject(null);
    s.setView("all");
    s.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [
        JSON.stringify(["remote:0", "native", "same-id"]),
        JSON.stringify(["remote:0", "acp", "same-id"]),
        JSON.stringify(["remote:1", "acp", "same-id"]),
      ],
      excludedItems: [],
    });
  });
  const card = (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const native = card("Remote API session"),
    failed = card("Remote ACP 1");
  const staged = page.locator('[data-board-column="staged"]');
  const tabs = page.getByRole("tablist", { name: "会话范围", exact: true });
  const count = (label, n) =>
    tabs.getByRole("tab", { name: new RegExp(`^${label}\\s*${n}$`) }).waitFor();
  const choose = (label) =>
    tabs.getByRole("tab", { name: new RegExp(`^${label}\\s*\\d+$`) }).click();
  const drag = async (source, target) => {
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox(),
      to = await target.boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 180), { steps: 18 });
    await page.mouse.up();
    // dnd-kit 在放下后保留 50ms 的 click capture，等待其释放后再操作下一个按钮。
    await page.waitForTimeout(80);
  };
  await count("已完成", 2);
  const commandsBefore = await page.evaluate(() => window.__board.commands.length);
  await drag(native.getByRole("button", { name: "拖动到暂存", exact: true }), staged);
  await count("暂存", 1);
  await count("已完成", 1);
  assert.equal(await staged.locator("article").count(), 1);
  assert.equal(
    await page.locator('[data-board-column="completed"] article').count(),
    1,
    "same id ACP remains completed",
  );
  await failed.getByRole("button", { name: "暂存", exact: true }).click();
  await count("暂存", 2);
  await count("失败", 0);
  await native.getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByText(/Same project · API · 暂存/)
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "归档", exact: true }).isEnabled(), true);
  await page.keyboard.press("Escape");
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(artifacts, theme.includes("dark") ? "staging-dark.png" : "staging-light.png"),
      animations: "disabled",
    });
  }
  await failed.getByRole("button", { name: "移出暂存", exact: true }).click();
  await count("失败", 1);
  await count("暂存", 1);
  assert.equal(await page.locator('[data-board-column="error"] article').count(), 1);
  await drag(failed.getByRole("button", { name: "拖动到暂存", exact: true }), staged);
  await count("暂存", 2);
  await failed.getByRole("button", { name: "移出暂存", exact: true }).focus();
  await page.keyboard.press("Enter");
  await count("失败", 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await choose("失败");
  await failed.getByRole("button", { name: "暂存", exact: true }).click();
  await count("暂存", 2);
  assert.equal(
    await page.locator("article").count(),
    0,
    "stage removes failed card from failed filter",
  );
  await choose("暂存");
  assert.equal(await staged.locator("article").count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "staging-mobile.png"), animations: "disabled" });
  await failed.getByRole("button", { name: "移出暂存", exact: true }).click();
  await count("暂存", 1);
  await native.getByRole("button", { name: "移出暂存", exact: true }).click();
  await count("暂存", 0);
  assert.equal(
    await page.locator('[data-board-column="staged"]').count(),
    1,
    "empty staging target stays visible",
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await choose("全部");
  await page.getByRole("combobox", { name: "分组方式", exact: true }).selectOption("project");
  await drag(
    native.getByRole("button", { name: "拖动到暂存", exact: true }),
    tabs.getByRole("tab", { name: /^暂存/ }),
  );
  await count("暂存", 1);
  assert.equal(
    await page.evaluate(() => window.__board.commands.length),
    commandsBefore,
    "staging never writes Host session or task lifecycle",
  );
  await page.reload();
  await native.getByRole("button", { name: "移出暂存", exact: true }).waitFor();
  await count("暂存", 1);
  await page.evaluate(() => window.__board.update(0, { liveStatus: "running", updatedAt: 5000 }));
  await count("暂存", 0);
  await count("进行中", 1);
  assert.equal(await native.getByRole("button", { name: "暂存", exact: true }).count(), 0);
  assert.equal(await native.getByRole("button", { name: "拖动到暂存", exact: true }).count(), 0);
  await page.evaluate(() => window.__board.update(0, { liveStatus: "completed", updatedAt: 5000 }));
  await count("暂存", 0);
  await native.getByRole("button", { name: "暂存", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "分组方式", exact: true }).selectOption("status");
  const staleHandle = await native
    .getByRole("button", { name: "拖动到暂存", exact: true })
    .boundingBox();
  await page.mouse.move(staleHandle.x + 10, staleHandle.y + 10);
  await page.mouse.down();
  await page.mouse.move(staleHandle.x + 35, staleHandle.y + 10);
  await page.evaluate(() => window.__board.update(0, { liveStatus: "running", updatedAt: 5100 }));
  await count("进行中", 1);
  const staleTarget = await staged.boundingBox();
  await page.mouse.move(staleTarget.x + 100, staleTarget.y + 100, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  await count("暂存", 0);
  await page.evaluate(() => window.__board.update(0, { liveStatus: "completed", updatedAt: 5100 }));
  await native.getByRole("button", { name: "暂存", exact: true }).waitFor();
  // 完成筛选中起拖时也要有可见投放区。
  await page.getByRole("combobox", { name: "分组方式", exact: true }).selectOption("status");
  await choose("已完成");
  const handle = native.getByRole("button", { name: "拖动到暂存", exact: true });
  await handle.scrollIntoViewIfNeeded();
  // 切换筛选后先等待手柄稳定且能接收指针，避免在列重新布局时按下旧坐标。
  await handle.hover();
  const from = await handle.boundingBox();
  assert.ok(from);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 3 });
  await staged.waitFor();
  const to = await staged.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + 100, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  await count("暂存", 1);
  // 验收待办暂存后，原来的验收入口仍然可用。
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "staging-review",
      title: "Staged review task",
      prompt: "Review",
      status: "review",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "fixture-provider", modelId: "model" },
      },
      stopPending: false,
      runText: "Review",
      commandId: "staging-command",
      sessionRequestId: "staging-request",
      session: { kind: "api", id: "staging-session" },
      archived: false,
      runSeq: 1,
      createdAt: 100,
      updatedAt: 6000,
    });
    f.notifyWork();
    f.store.getState().setTracking({ ...f.store.getState().tracking, workTasks: true });
    f.store.getState().setView("all");
  });
  const work = card("Staged review task");
  await work.getByRole("button", { name: "暂存", exact: true }).click();
  await work.getByRole("button", { name: "移出暂存", exact: true }).waitFor();
  await work.getByRole("button").first().click();
  await page.getByTestId("work-task-complete").waitFor();
  assert.equal(await page.evaluate(() => window.__board.workRows.at(-1).status), "review");
  await page.keyboard.press("Escape");
}
