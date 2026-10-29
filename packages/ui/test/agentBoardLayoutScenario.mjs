import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardLayout(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const { store, workRows, notifyWork } = window.__board;
    for (const task of workRows.slice(0, 2))
      Object.assign(task, { status: "running", archived: false });
    notifyWork();
    const state = store.getState();
    state.selectProject(null);
    state.setView("all");
    state.setAgent("all");
    state.setSearch("");
    state.setGroup("project");
    state.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [
        ...workRows
          .slice(0, 2)
          .map((task) => JSON.stringify([task.workspacePath, "work-task", task.id])),
        JSON.stringify(["/fixture/project-23", "native", "same-id"]),
      ],
      excludedItems: [],
    });
  });
  const groups = page.locator("[data-board-column]");
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 3);
  assert.equal(
    await groups.count(),
    2,
    "work task project must not add an empty conversation group",
  );
  assert.equal(await page.locator('[data-board-column="/fixture/project-3"]').count(), 0);
  const cards = page.locator('[data-board-column="work-tasks"] article');
  const a = await cards.nth(0).boundingBox(),
    b = await cards.nth(1).boundingBox();
  assert.ok(
    a.width <= 385 && b.width <= 385,
    "sparse groups must not stretch cards across the page",
  );
  assert.ok(Math.abs(a.y - b.y) < 2 && b.x > a.x, "desktop work tasks share one row");
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    assert.notEqual(
      await page
        .getByRole("heading", { name: "Agent 看板", exact: true })
        .evaluate((node) => getComputedStyle(node).color),
      theme.includes("dark") ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)",
      "board text follows the active theme",
    );
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark") ? "grouped-desktop-dark.png" : "grouped-desktop-light.png",
      ),
      animations: "disabled",
    });
  }
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("Implement project 23");
  assert.equal(await groups.count(), 1, "search removes empty sections");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileA = await cards.nth(0).boundingBox(),
    mobileB = await cards.nth(1).boundingBox();
  assert.ok(
    Math.abs(mobileA.x - mobileB.x) < 2 && mobileB.y > mobileA.y,
    "mobile cards stack within their group",
  );
  assert.ok(mobileA.width <= 390 && mobileA.x >= 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "grouped-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("combobox", { name: "分组方式", exact: true }).selectOption("status");
  assert.equal(
    await page.locator('[data-board-column="running"] article').count(),
    2,
    "only running work tasks stay ongoing; the ended conversation is completed",
  );
  await page.evaluate(() => {
    const { workRows, notifyWork, store } = window.__board;
    for (const [i, status] of [
      "failed",
      "done",
      "todo",
      "review",
      "awaiting_input",
      "canceled",
    ].entries())
      workRows.push({
        ...workRows[0],
        id: "status-example-" + i,
        title: "Status example " + status,
        status,
        archived: false,
      });
    workRows.push({
      ...workRows[0],
      id: "status-example-archived",
      title: "Archived completion",
      status: "done",
      archived: true,
    });
    notifyWork();
    store.getState().setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: true,
      includedItems: [],
      excludedItems: [],
    });
  });
  const statusTabs = page.getByRole("tablist", { name: "会话范围", exact: true });
  const choose = (label) =>
    statusTabs.getByRole("tab", { name: new RegExp("^" + label + "\\s*\\d+$") }).click();
  await statusTabs.getByRole("tab", { name: /^失败\s*2$/ }).waitFor();
  assert.equal(await statusTabs.getByRole("tab", { name: /需关注/ }).count(), 0);
  await choose("进行中");
  assert.equal(await page.locator("[data-board-card]").count(), 5);
  assert.equal(
    await page.getByRole("heading", { name: "Status example failed", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator('[data-board-column="idle"]').count(), 0);
  await choose("已完成");
  assert.equal(
    await page.locator("[data-board-card]").count(),
    3,
    "finished execution includes review, while archived completion is excluded",
  );
  assert.equal(await groups.count(), 1, "completion view starts with its own column");
  await choose("失败");
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  await page.getByRole("heading", { name: "Status example failed", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("zcode-agent-board:v1")).view),
    "failed",
  );
  await page.getByRole("heading", { name: "Status example failed", exact: true }).waitFor();
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.find((task) => task.id === "status-example-0").status = "running";
    f.notifyWork();
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 1);
  assert.equal(
    await page.getByRole("heading", { name: "Status example failed", exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.find((task) => task.id === "status-example-0").status = "failed";
    f.notifyWork();
  });
  await choose("全部");
  await page.setViewportSize({ width: 1600, height: 1000 });
  assert.equal(await groups.count(), 4);
  assert.deepEqual(
    await groups.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardColumn)),
    ["running", "completed", "error", "staged"],
  );
  for (const label of ["待验收", "等你回复", "待办", "本轮结束", "任务执行中", "已取消"])
    assert.equal(
      await page.getByText(label, { exact: true }).count(),
      0,
      "board hides legacy labels while keeping waiting indicators in ongoing",
    );
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark") ? "four-status-desktop-dark.png" : "four-status-desktop-light.png",
      ),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await choose("失败");
  assert.equal(await groups.count(), 1);
  assert.ok((await page.locator('[data-board-column="error"]').boundingBox()).x >= 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "four-status-mobile-failed.png"),
    animations: "disabled",
  });
  await choose("已完成");
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem("zcode-agent-board:v1")).view),
    "completed",
  );
  assert.equal(await page.locator("[data-board-card]").count(), 3);

  // 复现升级前少量项目且保留 project 偏好的真实入口，不能靠项目过多的分支通过。
  const legacyWorkRows = await page.evaluate(() => {
    const { workRows } = window.__board;
    const rows = workRows
      .slice(0, 2)
      .map((task) => ({ ...task, status: "running", archived: false }));
    const saved = JSON.parse(localStorage.getItem("zcode-agent-board:v1"));
    delete saved.layoutVersion;
    Object.assign(saved, {
      project: null,
      category: "all",
      group: "project",
      view: "all",
      agent: "all",
      search: "",
      tracking: {
        mode: "custom",
        projects: [],
        standalone: false,
        workTasks: false,
        includedItems: [
          ...rows.map((task) => JSON.stringify([task.workspacePath, "work-task", task.id])),
          JSON.stringify(["/fixture/project-23", "native", "same-id"]),
        ],
        excludedItems: [],
      },
    });
    localStorage.setItem("zcode-agent-board:v1", JSON.stringify(saved));
    return rows;
  });
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.evaluate((rows) => {
    window.__board.workRows.push(...rows);
    window.__board.notifyWork();
  }, legacyWorkRows);
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 3);
  assert.equal(
    await page.getByRole("combobox", { name: "分组方式", exact: true }).inputValue(),
    "status",
  );
  assert.deepEqual(
    await groups.evaluateAll((nodes) => nodes.map((node) => node.dataset.boardColumn)),
    ["running", "completed", "error", "staged"],
  );
  assert.equal(await page.locator('[data-board-column="running"] article').count(), 2);
  assert.equal(await page.locator('[data-board-column="completed"] article').count(), 1);
  assert.equal(await page.locator('[data-board-column="error"] article').count(), 0);
  // 用户可主动选项目分组，但从选择器回到所有项目后恢复四列。
  await page.getByRole("combobox", { name: "分组方式", exact: true }).selectOption("project");
  assert.equal(await groups.count(), 2);
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "所有项目", exact: true }).click();
  assert.equal(await groups.count(), 4);
  assert.equal(await page.evaluate(() => window.__board.store.getState().group), "status");
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark")
          ? "all-projects-migrated-dark.png"
          : "all-projects-migrated-light.png",
      ),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "all-projects-migrated-mobile.png"),
    animations: "disabled",
  });
}
