import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskConversationStatus(page, artifacts) {
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 850 });
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  for (const [kind, initialStatus] of [
    ["api", "failed"],
    ["acp", "failed"],
    ["api", "done"],
    ["acp", "done"],
  ]) {
    const task = await page.evaluate(
      ({ kind, initialStatus }) =>
        window.__tasks.seed({
          title: `Continued ${initialStatus} ${kind} task`,
          prompt: "Original task",
          status: initialStatus,
          runSeq: 1,
          failureReason: initialStatus === "failed" ? "Previous failure" : undefined,
          completion: initialStatus === "done" ? "accepted_without_merge" : undefined,
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          session: { kind, id: `continued-${initialStatus}-${kind}` },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/continued-${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/continued-${kind}`,
            baseCommit: "abcdef",
          },
        }),
      { kind, initialStatus },
    );
    const card = () => panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
    await card().getByRole("button", { name: task.title, exact: true }).click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    const session = panel.getByTestId("work-task-fixture-session");
    const previous = await session.elementHandle();
    const draft = session.getByRole("textbox", {
      name: "Synthetic conversation draft",
      exact: true,
    });
    await draft.fill("Continue");
    assert.equal(await card().locator(`[data-work-task-status="${initialStatus}"]`).count(), 1);
    await panel
      .locator(`[data-work-task-column="${initialStatus === "done" ? "done" : "attention"}"]`)
      .locator(`[data-task-id="${task.id}"]`)
      .waitFor();
    const header = panel.getByTestId("work-task-content").locator("header");
    for (const [status, column] of [
      ["running", "inProgress"],
      ["awaiting_input", "attention"],
      ["running", "inProgress"],
      ["review", "attention"],
      ["running", "inProgress"],
      ["failed", "attention"],
    ]) {
      // 只投影 Host 真实执行事实；状态不会由输入、选择或组件重挂载触发。
      await page.evaluate(
        ({ id, status }) => {
          const task = window.__tasks.tasks.find((task) => task.id === id);
          task.failureReason = status === "failed" ? "New failure" : undefined;
          task.completion = undefined;
          window.__tasks.status(id, status);
        },
        { id: task.id, status },
      );
      await header.locator(`[data-work-task-status="${status}"]`).waitFor();
      await panel
        .locator(`[data-work-task-column="${column}"]`)
        .locator(`[data-task-id="${task.id}"]`)
        .waitFor();
      await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
      assert.equal(
        await previous.evaluate((element) => element.isConnected),
        true,
        "status changes must not remount or close the bound conversation",
      );
      assert.equal(await draft.inputValue(), "Continue");
      assert.equal(await card().getAttribute("data-selected"), "true");
      if (status === "running")
        await page.screenshot({
          path: join(artifacts, `conversation-continued-${initialStatus}-${kind}.png`),
        });
    }
    await previous.dispose();
  }
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^(start|create|update|acp-create|acp-prompt)$/.test(call.op),
      ),
    ),
    false,
    "Host status projection must never submit or resend an input",
  );
}
