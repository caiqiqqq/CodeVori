import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardSidebar(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  const longName = "很长的项目名称用于检查四项计数仍然完整显示";
  await page.evaluate((longName) => {
    const f = window.__board;
    f.tabs[0].label = longName;
    f.update(0, { liveStatus: "running", activity: undefined, updatedAt: 2000 });
    f.update(1, { liveStatus: "completed", activity: undefined });
    f.updateAcp(0, { status: "idle", history: { createdAt: 100, updatedAt: 3000 } });
    f.updateAcp(1, { status: "interrupted" });
    const execution = {
      kind: "api",
      mode: "build",
      modelSelection: { providerId: "fixture-provider", modelId: "model" },
    };
    for (const [id, status, scope] of [
      ["sidebar-staged", "review", f.tabs[0]],
      ["sidebar-failed", "failed", f.tabs[0]],
      ["sidebar-queued", "queued", f.tabs[3]],
      ["sidebar-completed", "done", f.tabs[0]],
    ])
      f.workRows.push({
        workspacePath: scope.workspacePath,
        workspaceIdentity: scope.workspaceIdentity,
        remoteSessionId: scope.remoteSessionId,
        id,
        status,
        title: id,
        prompt: "Test sidebar counts",
        execution,
        stopPending: false,
        runSeq: 1,
        createdAt: 100,
        updatedAt: 4000,
        archived: false,
      });
    f.notifyWork();
    const key = (scope, kind, id = "same-id") => JSON.stringify([scope, kind, id]);
    const s = f.store.getState();
    s.selectProject(null);
    s.setSearch("");
    s.setAgent("all");
    s.setView("all");
    s.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: true,
      includedItems: [
        key("remote:0", "native"),
        key("remote:0", "acp"),
        key("remote:1", "native"),
        key("remote:1", "acp"),
        key("/fixture/project-7", "native"),
      ],
      excludedItems: [],
    });
    f.store.setState({
      pinnedProjects: ["remote:0", "/fixture/project-2", "/fixture/project-3"],
      stagedItems: {
        [key("remote:0", "work-task", "sidebar-staged")]: { updatedAt: 4000, outcome: "completed" },
      },
    });
    f.setSidebar(true);
  }, longName);
  const sidebar = page.getByTestId("board-sidebar");
  assert.equal((await sidebar.boundingBox()).width, 245, "exercise the real narrow sidebar width");
  const row = (name) => sidebar.getByRole("button", { name, exact: true });
  const expectCounts = async (name, expected) => {
    const target = row(name);
    await page.waitForFunction(
      ({ name, expected }) => {
        const button = [...document.querySelectorAll('[data-testid="board-sidebar"] button')].find(
          (b) => b.getAttribute("aria-label") === name,
        );
        const actual = Object.fromEntries(
          [...(button?.querySelectorAll("[data-board-sidebar-status]") ?? [])].map((node) => [
            node.dataset.boardSidebarStatus,
            Number(node.textContent),
          ]),
        );
        return JSON.stringify(actual) === JSON.stringify(expected);
      },
      { name, expected },
    );
    assert.equal(
      await target.locator("[data-board-sidebar-status] svg").count(),
      Object.keys(expected).length,
    );
  };
  await expectCounts("所有项目", { running: 2, completed: 2, staged: 1, error: 2 });
  await expectCounts(longName, { running: 1, completed: 1, staged: 1, error: 1 });
  await expectCounts("独立任务", { completed: 1, error: 1 });
  await expectCounts("待办任务", { running: 1, staged: 1, error: 1 });
  await expectCounts("Project 2", {});
  assert.equal(await row("Project 2").locator("[data-board-sidebar-counts]").count(), 0);
  const iconNames = ["play", "circle-check", "inbox", "triangle-alert"];
  for (const name of iconNames)
    assert.equal(await row(longName).locator(`svg.lucide-${name}`).count(), 1);
  assert.equal(await row("待办任务").locator("svg.lucide-list-todo").count(), 1);
  assert.match(
    await row(longName).getAttribute("aria-description"),
    /进行中 1.*已完成 1.*暂存 1.*失败 1/,
  );
  const before = await page.evaluate(() => window.__board.commands.length);
  await row("待办任务").click();
  assert.equal(await row("待办任务").getAttribute("aria-pressed"), "true");
  const main = page.locator("main");
  await main.getByRole("tab", { name: /^失败/ }).click();
  await main.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("no matching result");
  await expectCounts(longName, { running: 1, completed: 1, staged: 1, error: 1 });
  await main.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await row("所有项目").click();
  await main.getByRole("tab", { name: /^全部/ }).click();
  const acp = main
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 0", exact: true }) });
  await acp.getByRole("button", { name: "暂存", exact: true }).click();
  await expectCounts(longName, { running: 1, staged: 2, error: 1 });
  await acp.getByRole("button", { name: "移出暂存", exact: true }).click();
  await expectCounts(longName, { running: 1, completed: 1, staged: 1, error: 1 });
  assert.equal(await page.evaluate(() => window.__board.commands.length), before);
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate((theme) => (document.documentElement.className = theme), theme);
    for (const badge of await row(longName).locator("[data-board-sidebar-status]").all()) {
      const bounds = await badge.boundingBox(),
        container = await sidebar.boundingBox();
      assert.ok(
        bounds.x >= container.x && bounds.x + bounds.width <= container.x + container.width,
      );
    }
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark") ? "sidebar-counts-dark.png" : "sidebar-counts-light.png",
      ),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "sidebar-counts-mobile.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, { liveStatus: "completed", updatedAt: 5000 });
    f.updateAcp(1, { status: "running" });
    f.update(1, { archived: true });
  });
  await expectCounts(longName, { completed: 2, staged: 1, error: 1 });
  await expectCounts("独立任务", { running: 1 });
  await page.evaluate(() =>
    window.__board.store.getState().setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: true,
      includedItems: [],
      excludedItems: [],
    }),
  );
  await expectCounts("所有项目", { running: 1, staged: 1, error: 1 });
  await expectCounts("独立任务", {});
  await expectCounts(longName, { staged: 1, error: 1 });
  await page.evaluate(() => {
    const f = window.__board;
    const task = f.workRows.find((task) => task.id === "sidebar-staged");
    task.status = "done";
    task.forgeWriteback = { commentState: "pending", closeState: "done" };
    f.notifyWork();
  });
  await expectCounts("待办任务", { running: 1, staged: 1, error: 1 });
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.find((task) => task.id === "sidebar-staged").forgeWriteback.commentState = "done";
    f.notifyWork();
  });
  await expectCounts("所有项目", { running: 1, error: 1 });
  await expectCounts("待办任务", { running: 1, error: 1 });
  await expectCounts(longName, { error: 1 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const label of ["全部", "已完成", "暂存", "归档"]) {
    await main.getByRole("tab", { name: new RegExp("^" + label + "\\s*\\d+$") }).click();
    assert.equal(
      await main.getByRole("heading", { name: "sidebar-staged", exact: true }).count(),
      0,
    );
    assert.equal(
      await main.getByRole("heading", { name: "sidebar-completed", exact: true }).count(),
      0,
    );
  }
  await main.getByRole("tab", { name: /^全部/ }).click();
  await page.evaluate(() => {
    const f = window.__board;
    const task = f.workRows.find((task) => task.id === "sidebar-staged");
    task.status = "running";
    task.updatedAt++;
    f.notifyWork();
  });
  await expectCounts("所有项目", { running: 2, error: 1 });
  await main.getByRole("heading", { name: "sidebar-staged", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__board.commands.length), before);
  await page.evaluate(() =>
    window.__board.store.getState().setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [],
      excludedItems: [],
    }),
  );
  await expectCounts("所有项目", {});
  await expectCounts("待办任务", {});
  assert.equal(await sidebar.locator("[data-board-sidebar-counts]").count(), 0);
}
