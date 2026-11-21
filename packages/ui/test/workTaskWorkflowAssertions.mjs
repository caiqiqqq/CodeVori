import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskWorkflow(page, artifacts) {
  const diagnostics = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) diagnostics.push(message.text());
  });
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  assert.equal(await panel.getByTestId("work-task-configure-workflow").count(), 0);
  // Definition editing lives in Settings and is exercised by agentBoardWorkflow.e2e.
  // This regression retains legacy stage execution, conversation focus, and acceptance coverage.
  await page.evaluate(() => window.__tasks.selectTestWorkflow());
  await panel.getByTestId("work-task-new").click();
  const taskEditor = page.getByTestId("work-task-editor");
  await taskEditor.getByTestId("work-task-initial-stage").waitFor();
  assert.equal(await taskEditor.getByTestId("work-task-model").isDisabled(), true);
  await taskEditor.getByTestId("work-task-prompt").fill("Workflow delivery");
  await taskEditor.getByRole("button", { name: "保存", exact: true }).click();
  await taskEditor.waitFor({ state: "detached" });
  const task = await page.evaluate(() => {
    const row = window.__tasks.tasks[0];
    Object.assign(row, {
      status: "review",
      runSeq: 1,
      session: { kind: "api", id: "build-session" },
      worktree: {
        rootPath: "/trees",
        path: "/trees/workflow/project",
        projectPath: row.workspacePath,
        branchName: "worktree/workflow",
        baseCommit: "base",
      },
    });
    window.__tasks.changed();
    return structuredClone(row);
  });
  await panel.getByRole("button", { name: task.title, exact: true }).click();
  const content = panel.getByTestId("work-task-content");
  await content.getByTestId("workflow-advance").waitFor();
  assert.equal(
    await content.getByTestId("work-task-complete").count(),
    0,
    "middle stage cannot complete",
  );
  await content.getByTestId("workflow-advance").click();
  const handoff = page.getByTestId("workflow-handoff");
  await content
    .locator('[data-testid="work-task-fixture-session"][data-focused="false"]')
    .waitFor();
  await handoff.getByRole("textbox", { name: "交接说明（可选）" }).fill("Check boundary cases");
  await handoff.getByTestId("workflow-confirm-handoff").click();
  await handoff.waitFor({ state: "detached" });
  const next = await page.evaluate(() => structuredClone(window.__tasks.tasks[0]));
  assert.equal(next.execution.kind, "acp");
  assert.equal(next.workflow.history[0].handoffNote, "Check boundary cases");
  assert.equal(next.worktree.path, task.worktree.path);
  assert.equal(
    await page.evaluate(
      () => window.__tasks.calls.filter((r) => r.op === "transitionWorkflow").length,
    ),
    1,
  );
  assert.equal(
    await content.getByTestId("workflow-advance").count(),
    0,
    "active stage cannot transfer",
  );
  await page.evaluate(() => {
    window.__tasks.tasks[0].status = "review";
    window.__tasks.changed();
  });
  await content.getByTestId("workflow-return").waitFor();
  await content.getByRole("button", { name: "阶段历史", exact: true }).click();
  const history = page.getByTestId("workflow-history");
  await content
    .locator('[data-testid="work-task-fixture-session"][data-focused="false"]')
    .waitFor();
  await history.getByRole("button", { name: /实现.*Developer/ }).click();
  const session = history.getByTestId("work-task-fixture-session");
  await session.waitFor();
  assert.equal(await session.getAttribute("data-session"), "build-session");
  assert.equal(await session.getAttribute("data-readonly"), "true");
  assert.equal(await session.getByRole("textbox").isDisabled(), true);
  await page.keyboard.press("Escape");
  await history.waitFor({ state: "detached" });
  await content.locator('[data-testid="work-task-fixture-session"][data-focused="true"]').waitFor();
  const transfer = async (button) => {
    await content.getByTestId(button).click();
    await handoff.getByTestId("workflow-confirm-handoff").click();
    await handoff.waitFor({ state: "detached" });
    await page.evaluate(() => {
      window.__tasks.tasks[0].status = "review";
      window.__tasks.changed();
    });
  };
  await transfer("workflow-return");
  assert.equal(
    await page.evaluate(() => window.__tasks.tasks[0].workflow.currentStageId),
    task.workflow.currentStageId,
  );
  await transfer("workflow-advance");
  await transfer("workflow-advance");
  await content.getByTestId("work-task-complete").waitFor();
  assert.equal(await content.getByTestId("workflow-advance").count(), 0);
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 850 });
    assert.equal(await content.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: join(artifacts, `workflow-final-${width}.png`) });
  }
  assert.equal(
    await page.evaluate(
      () => window.__tasks.calls.filter((r) => ["complete", "merge"].includes(r.op)).length,
    ),
    0,
    "acceptance remains explicit",
  );
  assert.deepEqual(
    diagnostics,
    [],
    "workflow interactions must not emit browser warnings or errors",
  );
}
