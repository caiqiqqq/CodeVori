import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskNewSession(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  for (const [index, kind] of ["api", "acp"].entries()) {
    const task = await page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Damaged ${kind}`,
          prompt: `Continue ${kind}`,
          status: "failed",
          failureReason: "damaged context",
          runSeq: 1,
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          session: { kind, id: `damaged-${kind}` },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/damaged-${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/damaged-${kind}`,
            baseCommit: "abcdef",
          },
        }),
      kind,
    );
    const card = panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
    await card.getByRole("button", { name: "任务操作", exact: true }).click();
    const menu = page.locator('[role="menu"][data-state="open"]');
    await menu.getByRole("menuitem", { name: "重新开始", exact: true }).waitFor();
    await menu.getByRole("menuitem", { name: "使用新会话重新开始", exact: true }).waitFor();
    if (index === 0) {
      await page.screenshot({
        path: join(artifacts, "issue-137-menu.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      await card.getByRole("button", { name: task.title, exact: true }).click();
      await panel.getByRole("button", { name: "任务详情", exact: true }).click();
      const detail = page.getByTestId("work-task-detail");
      await detail.getByRole("button", { name: "使用新会话重新开始" }).waitFor();
      await page.screenshot({
        path: join(artifacts, "issue-137-detail.png"),
        animations: "disabled",
      });
      await detail.getByRole("button", { name: "使用新会话重新开始" }).click();
      await card.locator('[data-work-task-status="running"]').waitFor();
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });
    } else {
      await menu.getByRole("menuitem", { name: "使用新会话重新开始" }).click();
    }
    await card.locator('[data-work-task-status="running"]').waitFor();
    const result = await page.evaluate((id) => {
      const task = window.__tasks.tasks.find((item) => item.id === id);
      return {
        task,
        starts: window.__tasks.calls.filter((call) => call.op === "start" && call.id === id),
      };
    }, task.id);
    assert.equal(result.starts.length, 1);
    assert.equal(result.starts[0].newSession, true);
    assert.equal(result.task.session.id, `session-${task.id}`);
    assert.equal(result.task.worktree.path, task.worktree.path);
    assert.equal(result.task.worktree.branchName, task.worktree.branchName);
    assert.equal(result.task.runSeq, 2);
  }
  await page.evaluate(() => window.__tasks.setLocale("en-US"));
  await page.evaluate(() => window.__tasks.status("task-0", "failed"));
  const card = panel.locator('[data-testid="work-task-card"][data-task-id="task-0"]');
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.setViewportSize({ width: 320, height: 750 });
    const back = panel.getByTestId("work-task-content").getByTestId("work-task-back");
    if (await back.isVisible()) await back.click();
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    assert.equal(
      await card.evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
    );
    if (theme === "zai-light") {
      await card.getByRole("button", { name: "Task actions" }).click();
      const menu = page.locator('[role="menu"][data-state="open"]');
      await menu.getByRole("menuitem", { name: "Restart with new session" }).waitFor();
      assert.equal(
        await menu.evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      );
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
  }
}
