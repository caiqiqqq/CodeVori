import assert from "node:assert/strict";

export async function exerciseAgentBoardNotificationNavigation(page) {
  await page.evaluate(() => {
    const board = window.__board;
    board.store.getState().selectProject("/fixture/project-3");
    board.store.getState().setView("failed");
    board.store.getState().setSearch("hidden target");
    board.notify({
      kind: "api",
      workspacePath: "/fixture/project-2",
      taskId: "same-id",
      fromNotification: true,
    });
  });
  await page.getByRole("dialog").getByText("Waiting for review", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "搜索会话…" }).inputValue(), "");
  assert.equal(await page.getByRole("tab", { name: /全部/ }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(() => {
    window.__board.notify({
      kind: "acp",
      session: {
        id: "same-id",
        workspacePath: "/same",
        workspaceIdentity: "remote:1",
        remoteSessionId: "host-1",
      },
      fromNotification: true,
    });
  });
  await page.getByRole("dialog").getByText("Remote ACP 1", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(() => {
    const board = window.__board;
    const key = JSON.stringify(["/fixture/project-2", "native", "same-id"]);
    board.store.getState().setTracking({
      ...board.store.getState().tracking,
      mode: "custom",
      projects: ["/fixture/project-2"],
      excludedItems: [key],
    });
    board.notify({
      kind: "api",
      workspacePath: "/fixture/project-2",
      taskId: "same-id",
      fromNotification: true,
    });
  });
  await page.waitForFunction(() => window.__board.notificationFallbacks.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__board.notificationFallbacks[0]), {
    kind: "api",
    workspacePath: "/fixture/project-2",
    taskId: "same-id",
    fromNotification: true,
  });
  await page.evaluate(() => {
    const board = window.__board;
    board.store.getState().setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [JSON.stringify(["/fixture/project-2", "native", "same-id"])],
      excludedItems: [],
    });
    board.notify({ kind: "api-notification", taskId: "same-id", fromNotification: true });
  });
  await page.getByRole("dialog").getByText("Waiting for review", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(() =>
    window.__board.store.getState().setTracking({
      mode: "all",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [],
      excludedItems: [],
    }),
  );
  await page.evaluate(() =>
    window.__board.notify({ kind: "api-notification", taskId: "same-id", fromNotification: true }),
  );
  await page.waitForFunction(() => window.__board.notificationFallbacks.length === 2);
  assert.equal(await page.getByRole("dialog").count(), 0);
}
