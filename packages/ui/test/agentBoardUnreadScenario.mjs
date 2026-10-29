import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardUnread(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, {
      liveStatus: "completed",
      updatedAt: 10000,
      unreadAt: 50000,
      activity: { phase: "completedSuccess", hasBackgroundWork: false, lastActivityAt: 50000 },
    });
    f.updateAcp(0, {
      status: "idle",
      unreadAt: 40000,
      entries: [{ kind: "user", text: "Finished result", createdAt: 100, endedAt: 40000 }],
      history: { createdAt: 100, updatedAt: 100000 },
    });
    const template = f.workRows.find((row) => row.id === "staging-review");
    f.workRows.push({
      ...template,
      id: "unread-result",
      title: "Unread work result",
      status: "review",
      runSeq: 1,
      finishedAt: 30000,
      updatedAt: 99000,
    });
    f.notifyWork();
    const s = f.store.getState();
    s.selectProject(null);
    s.setView("completed");
    s.setSearch("");
    s.setAgent("all");
    s.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [
        JSON.stringify(["remote:0", "native", "same-id"]),
        JSON.stringify(["remote:0", "acp", "same-id"]),
        JSON.stringify(["/fixture/project-3", "work-task", "unread-result"]),
      ],
      excludedItems: [],
    });
  });
  const card = (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const native = card("Remote API session"),
    acp = card("Remote ACP 0"),
    work = card("Unread work result");
  const order = () => page.locator('[data-board-column="completed"] article h3').allTextContents();
  const expected = ["Remote API session", "Remote ACP 0", "Unread work result"];
  await work.getByText("未读", { exact: true }).waitFor();
  assert.deepEqual(
    await order(),
    expected,
    "completion timestamps override inverse metadata timestamps",
  );
  assert.equal(await page.locator("[data-board-unread]").count(), 3);
  // 离线浏览不能把 Host 的未读标记伪装为已清除。
  await page.evaluate(() => window.__board.update(0, { sourceAvailability: "offline" }));
  await native.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  const beforeOffline = await page.evaluate(() => window.__board.commands.length);
  await native.getByRole("button").first().click();
  await page.getByTestId("real-pane-contract").waitFor();
  assert.equal(await page.getByTestId("real-pane-contract").getAttribute("data-readonly"), "true");
  await page.keyboard.press("Escape");
  await native.getByText("未读", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__board.commands.length), beforeOffline);
  await page.evaluate(() => window.__board.update(0, { sourceAvailability: "online" }));
  await native.getByText("离线 · 暂不可操作", { exact: true }).waitFor({ state: "hidden" });
  // 旧点击遇到新结果：只允许清除点击时观察到的版本。
  await page.evaluate(() => (window.__board.raceRead = true));
  await native.getByRole("button").first().click();
  await page.waitForFunction(() => window.__board.native[0].unreadAt === 55000);
  await page.getByTestId("real-pane-contract").waitFor();
  await page.keyboard.press("Escape");
  await native.getByText("未读", { exact: true }).waitFor();
  await native.getByRole("button").first().click();
  await page.waitForFunction(() => window.__board.native[0].unreadAt === undefined);
  await page.keyboard.press("Escape");
  await native.locator("[data-board-unread]").waitFor({ state: "hidden" });
  await acp.getByText("未读", { exact: true }).waitFor();
  assert.deepEqual(await order(), expected, "read acknowledgement does not reorder results");
  await page.evaluate(() => (window.__board.rejectReads = true));
  await acp.getByRole("button").first().click();
  await page.getByText("操作失败，会话状态可能已变化，请刷新后重试", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await acp.getByText("未读", { exact: true }).waitFor();
  await page.evaluate(() => (window.__board.rejectReads = false));
  await acp.getByRole("button").first().click();
  await page.getByTestId("real-pane-contract").waitFor();
  await page.keyboard.press("Escape");
  await acp.locator("[data-board-unread]").waitFor({ state: "hidden" });
  const readCommands = await page.evaluate(() =>
    window.__board.commands.filter(
      (c) => c.mutation?.kind === "mark-read" || c.action?.kind === "unread",
    ),
  );
  assert.equal(readCommands[0].mutation.expectedUnreadAt, 50000);
  assert.equal(readCommands[0].address.workspaceIdentity, "remote:0");
  assert.equal(readCommands[0].address.remoteSessionId, "host-0");
  assert.equal(readCommands.at(-1).action.expectedUnreadAt, 40000);
  assert.equal(readCommands.at(-1).remoteSessionId, "host-0");
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, { unreadAt: 56000 });
    const row = f.workRows.find((row) => row.id === "unread-result");
    row.updatedAt = 200000;
    f.notifyWork();
  });
  await native.getByText("未读", { exact: true }).waitFor();
  assert.deepEqual(
    await order(),
    expected,
    "metadata changes do not move a result above a newer completion",
  );
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((theme) => (document.documentElement.className = theme), theme);
    await page.screenshot({
      path: join(artifacts, theme.includes("dark") ? "unread-dark.png" : "unread-light.png"),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(artifacts, "unread-mobile.png"), animations: "disabled" });
  await work.getByRole("button").first().click();
  await page.getByTestId("work-task-complete").waitFor();
  await page.keyboard.press("Escape");
  await work.locator("[data-board-unread]").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => window.__board.workRows.find((row) => row.id === "unread-result").status,
    ),
    "review",
  );
  const savedWork = await page.evaluate(() =>
    window.__board.workRows.find((row) => row.id === "unread-result"),
  );
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.evaluate((row) => {
    window.__board.workRows.push(row);
    window.__board.notifyWork();
  }, savedWork);
  await work.getByRole("heading").waitFor();
  assert.equal(
    await work.locator("[data-board-unread]").count(),
    0,
    "work-result read preference survives reload",
  );
  await page.evaluate(() => {
    const f = window.__board,
      row = f.workRows.find((row) => row.id === "unread-result");
    row.status = "done";
    row.updatedAt++;
    f.notifyWork();
  });
  await work.getByText("已完成", { exact: true }).waitFor();
  assert.equal(
    await work.locator("[data-board-unread]").count(),
    0,
    "acceptance does not recreate unread",
  );
  await page.evaluate(() => {
    const f = window.__board,
      row = f.workRows.find((row) => row.id === "unread-result");
    row.status = "review";
    row.runSeq++;
    row.finishedAt = 60000;
    f.notifyWork();
  });
  await work.getByText("未读", { exact: true }).waitFor();
}
