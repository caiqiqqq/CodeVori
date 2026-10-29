import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardInterruption(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, { liveStatus: "running", updatedAt: 3000 });
    f.updateAcp(1, { status: "running" });
    const s = f.store.getState();
    s.selectProject(null);
    s.setSearch("");
    s.setAgent("all");
    s.setView("all");
    s.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [
        JSON.stringify(["remote:0", "native", "same-id"]),
        JSON.stringify(["remote:1", "acp", "same-id"]),
      ],
      excludedItems: [],
    });
  });
  const tabs = page.getByRole("tablist", { name: "会话范围", exact: true });
  const count = (label, n) =>
    tabs.getByRole("tab", { name: new RegExp(`^${label}\\s*${n}$`) }).waitFor();
  const choose = (label) =>
    tabs.getByRole("tab", { name: new RegExp(`^${label}\\s*\\d+$`) }).click();
  await count("进行中", 2);
  await page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true });
  await search.fill("Remote ACP 1");
  const candidate = page.getByRole("dialog").locator("label").filter({ hasText: "Remote ACP 1" });
  await candidate.getByText("claude · 进行中", { exact: true }).waitFor();
  await page.evaluate(() => window.__board.updateAcp(1, { status: "idle" }));
  await candidate.getByText("claude · 已完成", { exact: true }).waitFor();
  await page.evaluate(() => window.__board.updateAcp(1, { status: "running" }));
  await candidate.getByText("claude · 进行中", { exact: true }).waitFor();
  // 原始中断事件没有 error：复现侧栏 failed=false 但看板仍显示进行中的缺口。
  await page.evaluate(() => window.__board.updateAcp(1, { status: "interrupted" }));
  await candidate.getByText("claude · 失败", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await count("进行中", 1);
  await count("失败", 1);
  await count("已完成", 0);
  await page.evaluate(() =>
    window.__board.update(0, {
      liveStatus: "completed",
      activity: { phase: "completedSuccess", lastActivityAt: 3050, hasBackgroundWork: false },
      updatedAt: 3050,
    }),
  );
  await count("进行中", 0);
  await count("已完成", 1);
  await page.getByRole("button", { name: /Remote API session/ }).click();
  await page
    .getByRole("dialog")
    .getByText(/Same project · API · 已完成/)
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "标记完成", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.__board.update(0, {
      liveStatus: "running",
      activity: { phase: "running", lastActivityAt: 3075, hasBackgroundWork: false },
      updatedAt: 3075,
    }),
  );
  await count("进行中", 1);
  await page.evaluate(() =>
    window.__board.update(0, {
      liveStatus: "completed",
      activity: { phase: "completedInterrupted", lastActivityAt: 3100, hasBackgroundWork: false },
      updatedAt: 3100,
    }),
  );
  await count("进行中", 0);
  await count("失败", 2);
  await choose("失败");
  assert.equal(await page.locator('[data-board-column="error"] article').count(), 2);
  await page.getByRole("button", { name: /Remote API session/ }).click();
  await page
    .getByRole("dialog")
    .getByText(/Same project · API · 失败/)
    .waitFor();
  await page.keyboard.press("Escape");
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark") ? "interrupted-dark.png" : "interrupted-light.png",
      ),
      animations: "disabled",
    });
  }
  // 重连重新读取同一 Host 摘要，不能恢复为旧的进行中分类。
  await page.evaluate(() => {
    const s = window.__remoteStore.getState();
    window.__interruptedConnection = s.sessionsById["host-1"];
    s.unregisterSession("host-1");
  });
  await page.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  await page.evaluate(() => {
    const s = window.__remoteStore.getState();
    s.registerSession(window.__interruptedConnection);
    s.bindWorkspaceIdentity("remote:1", "host-1");
  });
  await page.getByText("离线 · 暂不可操作", { exact: true }).waitFor({ state: "hidden" });
  await count("失败", 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "interrupted-mobile.png"),
    animations: "disabled",
  });
  await page.evaluate(() => window.__board.updateAcp(1, { status: "running" }));
  await count("进行中", 1);
  await count("失败", 1);
  assert.equal(await page.getByRole("heading", { name: "Remote ACP 1", exact: true }).count(), 0);
  await choose("进行中");
  await page.getByRole("heading", { name: "Remote ACP 1", exact: true }).waitFor();
  assert.equal(await page.locator('[data-board-column="running"] article').count(), 1);
  await page.evaluate(() => {
    const f = window.__board;
    f.updateAcp(1, { status: "idle" });
    f.updateAcp(0, { status: "interrupted", boardCompletedAt: 999999 });
    f.update(0, {
      liveStatus: "running",
      activity: { phase: "running", hasBackgroundWork: false, lastActivityAt: 3200 },
    });
    const s = f.store.getState();
    s.setView("all");
    s.setTracking({
      ...s.tracking,
      includedItems: [...s.tracking.includedItems, JSON.stringify(["remote:0", "acp", "same-id"])],
    });
  });
  await count("进行中", 1);
  await count("已完成", 1);
  await count("失败", 1);
  assert.equal(await page.locator('[data-board-column="completed"] article').count(), 1);
  assert.equal(await page.locator('[data-board-column="error"] article').count(), 1);
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    await page.screenshot({
      path: join(
        artifacts,
        theme.includes("dark") ? "automatic-status-dark.png" : "automatic-status-light.png",
      ),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await choose("已完成");
  await page.getByRole("heading", { name: "Remote ACP 1", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "automatic-status-mobile.png"),
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(() =>
      window.__board.commands.some(
        (c) => c.mutation?.kind === "board-completion" || c.action?.kind === "completion",
      ),
    ),
    false,
  );
}
