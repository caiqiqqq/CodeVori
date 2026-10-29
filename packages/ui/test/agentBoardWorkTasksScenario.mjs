import assert from "node:assert/strict";
import { join } from "node:path";
export async function exerciseAgentBoardWorkTasks(page, { manage, save, pane, artifacts }) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    for (const [i, status] of ["review", "awaiting_input", "todo"].entries())
      f.workRows.push({
        workspacePath: "/fixture/project-3",
        id: "work-" + i,
        title: "Tracked work " + i,
        prompt: "Task prompt",
        status,
        execution: {
          kind: "api",
          modelSelection: { providerId: "fixture-provider", modelId: "model" },
          mode: "build",
        },
        archived: false,
        stopPending: false,
        runSeq: 1,
        runText: "Task prompt",
        commandId: "command",
        sessionRequestId: "request",
        createdAt: 100,
        updatedAt: 7000 + i,
        session: { kind: "api", id: "bound-" + i },
        ...(i === 1
          ? {
              worktree: {
                path: "/fixture/worktrees/execution",
                branchName: "task/work-1",
                baseCommit: "base",
              },
            }
          : {}),
      });
    f.notifyWork();
  });
  await page.getByRole("heading", { name: "Tracked work 0", exact: true }).waitFor();
  await manage();
  await page.getByRole("radio", { name: "自定义显示", exact: true }).check();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Tracked work");
  const workGroup = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^待办任务/ }) });
  await workGroup.getByRole("checkbox").first().check();
  await page.getByRole("checkbox", { name: /Tracked work 2/ }).uncheck();
  await save();
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("button", { name: "待办任务", exact: true }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  await page.getByRole("button", { name: /Tracked work 1/ }).click();
  await pane.waitFor();
  assert.equal(
    await page.evaluate(() => window.__pane.workspacePath),
    "/fixture/worktrees/execution",
  );
  assert.equal(await pane.getAttribute("data-native-id"), "bound-1");
  await page.keyboard.press("Escape");
  await page.getByTestId("work-task-content").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /Tracked work 0/ }).click();
  await page.getByTestId("work-task-complete").click();
  const completion = page.getByTestId("work-task-completion-dialog");
  await completion.waitFor();
  await page.evaluate(() => (window.__board.rejectCompletion = true));
  await page.getByTestId("work-task-confirm-complete").click();
  await completion.getByText("Synthetic acceptance failed", { exact: true }).waitFor();
  await page.evaluate(() => (window.__board.rejectCompletion = false));
  await page.getByTestId("work-task-confirm-complete").click();
  await completion.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__board.commands.at(-1).workspacePath),
    "/fixture/project-3",
  );
  assert.equal(
    await page.evaluate(() => window.__board.commands.at(-1).kind),
    "work-task-complete",
  );
  await page.getByTestId("work-task-back").click();
  await page.getByTestId("work-task-content").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document
      .querySelector('[data-board-column="completed"]')
      ?.textContent.includes("Tracked work 0"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Tracked work 0/ }).click();
  await page.getByTestId("work-task-content").waitFor();
  await page.mouse.move(380, 800);
  await page.screenshot({ path: join(artifacts, "mobile-work-task.png"), animations: "disabled" });
  assert.equal(await page.getByTestId("work-task-complete").count(), 0);
  await page.getByTestId("work-task-back").click();
  await page.getByTestId("work-task-content").waitFor({ state: "hidden" });
  await page.evaluate(() => {
    window.__board.workRows[1].status = "done";
    window.__board.notifyWork();
  });
  await page.getByRole("button", { name: /Tracked work 1/ }).click();
  await pane.waitFor();
  await page.getByRole("button", { name: "任务操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "true",
  );
  assert.equal(await page.evaluate(() => window.__board.commands.at(-1).kind), "work-task-archive");
  await page.getByTestId("work-task-back").click();
  await page.getByRole("tab", { name: /归档/ }).click();
  await page.getByRole("button", { name: /Tracked work 1/ }).click();
  await page.getByRole("button", { name: "任务操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "取消归档", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "false",
  );
  await page.getByTestId("work-task-back").click();
}
