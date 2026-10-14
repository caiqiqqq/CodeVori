import assert from "node:assert/strict";
import { join } from "node:path";
import {
  assertWorkTaskSessionTarget,
  remountWorkTaskPanel,
} from "./workTaskWorkbenchLayoutAssertions.mjs";

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
          worktreeCleanup:
            initialStatus === "done"
              ? {
                  id: `cleanup-${kind}`,
                  phase: "failed",
                  error: "work-task.worktree-remove-dirty-worktree",
                }
              : undefined,
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
    if (initialStatus === "done") {
      await card().getByText("清理失败", { exact: true }).waitFor();
      await header.getByText("清理失败", { exact: true }).waitFor();
      await panel.getByTestId("work-task-content").getByRole("alert").waitFor();
    }
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
          // 合成 Host 投影与真实 claimConversation 一致：真实新轮原子清除旧清理事实。
          task.worktreeCleanup = undefined;
          window.__tasks.status(id, status);
        },
        { id: task.id, status },
      );
      await header.locator(`[data-work-task-status="${status}"]`).waitFor();
      assert.equal(await header.locator("[data-worktree-cleanup]").count(), 0);
      assert.equal(await card().locator("[data-worktree-cleanup]").count(), 0);
      assert.equal(await panel.getByTestId("work-task-content").getByRole("alert").count(), 0);
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
    if (initialStatus === "done") {
      await remountWorkTaskPanel(page, panel);
      const content = panel.getByTestId("work-task-content");
      for (const locale of ["zh-CN", "en-US"]) {
        await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
        for (const theme of ["zai-light", "zai-dark"]) {
          await page.evaluate((theme) => {
            document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
          }, theme);
          for (const width of [1280, 320]) {
            await page.setViewportSize({ width, height: 850 });
            await page.waitForFunction(
              (width) =>
                document.getElementById("work-task-workbench")?.getAttribute("data-wide") ===
                String(width >= 768),
              width,
            );
            await content
              .getByRole("button", {
                name: locale === "zh-CN" ? "任务详情" : "Task details",
                exact: true,
              })
              .click();
            const detail = page.getByTestId("work-task-detail");
            await detail.locator('[data-work-task-status="failed"]').waitFor();
            assert.equal(await detail.locator("[data-worktree-cleanup]").count(), 0);
            assert.equal(await detail.getByRole("alert").innerText(), "New failure");
            await page.keyboard.press("Escape");
            await detail.waitFor({ state: "detached" });
            assert.equal(await content.locator("[data-worktree-cleanup]").count(), 0);
          }
        }
      }
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
    }
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
