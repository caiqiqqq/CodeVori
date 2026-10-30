import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardWaiting(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, {
      liveStatus: "running",
      updatedAt: 8000,
      pendingInteraction: undefined,
      activity: { phase: "running", hasBackgroundWork: false },
    });
    f.updateAcp(1, {
      status: "running",
      pendingPermission: null,
      pendingElicitation: null,
    });
    const template = f.workRows.find((row) => row.id === "staging-review");
    for (const [i, status] of ["todo", "queued", "awaiting_input", "preparing"].entries())
      f.workRows.push({
        ...template,
        id: "waiting-" + status,
        title: "Waiting task " + status,
        status,
        updatedAt: 9000 + i,
      });
    f.notifyWork();
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
        JSON.stringify(["remote:1", "acp", "same-id"]),
        ...["todo", "queued", "awaiting_input", "preparing"].map((status) =>
          JSON.stringify(["/fixture/project-3", "work-task", "waiting-" + status]),
        ),
      ],
      excludedItems: [],
    });
  });
  const card = (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const native = card("Remote API session"),
    acp = card("Remote ACP 1");
  const ongoing = page.locator('[data-board-column="running"]');
  const tabs = page.getByRole("tablist", { name: "会话范围", exact: true });
  const count = (n) => tabs.getByRole("tab", { name: new RegExp(`^进行中\\s*${n}$`) }).waitFor();
  await count(6);
  await native.getByText("进行中", { exact: true }).waitFor();
  await acp.getByText("进行中", { exact: true }).waitFor();
  for (const status of ["todo", "queued", "awaiting_input"])
    await card("Waiting task " + status)
      .getByText("等待", { exact: true })
      .waitFor();
  await card("Waiting task preparing").getByText("进行中", { exact: true }).waitFor();
  for (const target of [native, acp, card("Waiting task preparing")]) {
    const spinner = target.locator("[data-board-running-indicator]");
    await spinner.waitFor();
    assert.equal(await spinner.evaluate((node) => getComputedStyle(node).animationName), "spin");
    const before = await spinner.evaluate((node) => getComputedStyle(node).transform);
    await page.waitForTimeout(100);
    assert.notEqual(await spinner.evaluate((node) => getComputedStyle(node).transform), before);
  }
  assert.equal(await ongoing.locator("h2 [data-board-running-indicator]").count(), 1);
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(artifacts, theme.includes("dark") ? "running-dark.png" : "running-light.png"),
    });
  }
  await page.evaluate(() => {
    window.__board.update(0, {
      activity: {
        phase: "running",
        hasBackgroundWork: true,
        pendingInteractions: { permissionCount: 1, userInputCount: 0 },
      },
    });
    window.__board.updateAcp(1, {
      pendingPermission: {
        requestId: "waiting-permission",
        title: "Run command",
        options: [],
      },
    });
  });
  await native.getByText("等待", { exact: true }).waitFor();
  await acp.getByText("等待", { exact: true }).waitFor();
  assert.equal(await native.locator("[data-board-running-indicator]").count(), 0);
  assert.equal(await acp.locator("[data-board-running-indicator]").count(), 0);
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.find((row) => row.id === "waiting-preparing").status = "queued";
    f.notifyWork();
  });
  await card("Waiting task preparing").getByText("等待", { exact: true }).waitFor();
  assert.equal(await ongoing.locator("[data-board-running-indicator]").count(), 0);
  assert.equal(await ongoing.locator("article").count(), 6);
  assert.equal(await page.locator('[data-board-column="waiting"]').count(), 0);
  assert.equal(await ongoing.getByText("等待", { exact: true }).count(), 6);
  assert.equal(await ongoing.getByRole("button", { name: "暂存", exact: true }).count(), 0);
  await native.getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByText(/Same project · API · 等待/)
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "归档", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await acp.getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByText(/Claude · 等待/)
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Remote API session");
  await page
    .getByRole("dialog")
    .locator("label")
    .filter({ hasText: "Remote API session" })
    .getByText("等待", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(artifacts, theme.includes("dark") ? "waiting-dark.png" : "waiting-light.png"),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await tabs.getByRole("tab", { name: /^进行中/ }).click();
  await native.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "waiting-mobile.png"), animations: "disabled" });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, {
      activity: {
        phase: "running",
        hasBackgroundWork: true,
        pendingInteractions: { permissionCount: 0, userInputCount: 0 },
      },
    });
    f.updateAcp(1, { pendingPermission: null, pendingElicitation: null });
    for (const row of f.workRows.filter((row) => row.id.startsWith("waiting-")))
      row.status = "running";
    f.notifyWork();
  });
  await count(6);
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("article span")).some(
        (node) => node.textContent === "等待",
      ),
  );
  await native.getByText("进行中", { exact: true }).waitFor();
  await acp.getByText("进行中", { exact: true }).waitFor();
  assert.equal(await ongoing.locator("[data-board-running-indicator]").count(), 7);
  await page.screenshot({ path: join(artifacts, "running-mobile.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await native
      .locator("[data-board-running-indicator]")
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.__board.update(0, { sourceAvailability: "offline" }));
  await native.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  assert.equal(await native.locator("[data-board-running-indicator]").count(), 0);
  await page.evaluate(() => window.__board.update(0, { sourceAvailability: "online" }));
  await native.locator("[data-board-running-indicator]").waitFor();
  await page.evaluate(() => {
    window.__board.update(0, {
      liveStatus: "completed",
      activity: { phase: "completedSuccess", hasBackgroundWork: false },
    });
    window.__board.updateAcp(1, { status: "idle" });
  });
  await count(4);
  await tabs.getByRole("tab", { name: /^已完成\s*2$/ }).waitFor();
  await tabs.getByRole("tab", { name: /^已完成/ }).click();
  assert.equal(await page.locator("[data-board-running-indicator]").count(), 0);
  await tabs.getByRole("tab", { name: /^全部/ }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
}
