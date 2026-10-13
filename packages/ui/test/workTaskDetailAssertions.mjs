import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskDetail(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const content = panel.getByTestId("work-task-content");
  const detail = page.getByTestId("work-task-detail");
  const assertTarget = async (task) => {
    await content
      .locator(
        `[data-testid="work-task-fixture-session"][data-kind="${task.execution.kind}"][data-session="${task.session.id}"][data-workspace="${task.worktree.path}"]`,
      )
      .waitFor();
    assert.equal(await content.getByTestId("work-task-fixture-session").count(), 1);
  };
  await panel.getByTestId("work-task-board").waitFor();
  const tasks = await page.evaluate(() => {
    const tasks = ["api", "acp"].map((kind) =>
      window.__tasks.seed({
        title: `Detail ${kind}`,
        prompt: `Original ${kind} instructions`,
        status: "review",
        runSeq: 2,
        execution:
          kind === "api"
            ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" } }
            : { kind, agent: "codex", config: [] },
        session: { kind, id: `detail-${kind}` },
        sourceBranch: "main",
        worktree: {
          rootPath: "/synthetic/trees",
          path: `/synthetic/trees/detail-${kind}/project`,
          projectPath: "/synthetic/project",
          branchName: `worktree/detail-${kind}`,
          baseCommit: "base",
        },
      }),
    );
    window.__tasks.events = [
      { sequence: 1, taskId: "task", runSeq: 1, at: 0, type: "created" },
      { sequence: 2, taskId: "task", runSeq: 1, at: 1, type: "execution-updated" },
      { sequence: 3, taskId: "task", runSeq: 2, at: 2, type: "conversation-continued" },
      { sequence: 4, taskId: "task", runSeq: 2, at: 3, type: "forge-writeback-lease" },
    ];
    return tasks;
  });
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 850 });
    if (width === 320) await content.getByTestId("work-task-back").click();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
      }, theme);
      for (const locale of ["zh-CN", "en-US"]) {
        await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
        for (const task of tasks) {
          const card = panel.locator(`[data-task-id="${task.id}"]`);
          await card.getByRole("button", { name: task.title, exact: true }).click();
          await assertTarget(task);
          const draft = content.getByRole("textbox", { name: "Synthetic conversation draft" });
          await draft.fill(`Keep ${task.id} draft`);
          const session = await content.getByTestId("work-task-fixture-session").elementHandle();
          const openDetails = () =>
            content
              .getByRole("button", {
                name: locale === "zh-CN" ? "任务详情" : "Task details",
                exact: true,
              })
              .click();
          await openDetails();
          await detail.waitFor();
          assert.equal(await detail.getByTestId("work-task-feedback").count(), 0);
          assert.equal(await detail.getByTestId("work-task-follow-up").count(), 0);
          assert.equal(await detail.locator("form, textarea").count(), 0);
          assert.equal(await detail.getByText(task.prompt, { exact: true }).count(), 1);
          assert.equal(await detail.getByText(task.worktree.path, { exact: true }).count(), 1);
          await detail
            .getByText(locale === "zh-CN" ? "继续对话" : "Conversation continued", { exact: true })
            .waitFor();
          assert.equal(
            await detail
              .getByText("workTasks.event.conversation-continued", { exact: true })
              .count(),
            0,
          );
          assert.deepEqual(await detail.locator("ol li").allTextContents(), [
            `1${locale === "zh-CN" ? "创建任务" : "Task created"}`,
            `3${locale === "zh-CN" ? "继续对话" : "Conversation continued"}`,
          ]);
          assert.equal(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
          await page.screenshot({
            path: join(artifacts, `detail-${task.execution.kind}-${width}-${theme}-${locale}.png`),
            animations: "disabled",
          });
          await page.keyboard.press("Escape");
          await detail.waitFor({ state: "detached" });
          assert.equal(await draft.inputValue(), `Keep ${task.id} draft`);
          assert.equal(await session.evaluate((el) => el.isConnected), true);
          await session.dispose();
          await openDetails();
          await detail.getByTestId("work-task-open-conversation").click();
          await detail.waitFor({ state: "detached" });
          await assertTarget(task);
          assert.equal(await draft.inputValue(), `Keep ${task.id} draft`);
          if (width === 320) await content.getByTestId("work-task-back").click();
        }
      }
    }
  }
  await panel
    .locator(`[data-task-id="${tasks[0].id}"]`)
    .getByRole("button", {
      name: tasks[0].title,
      exact: true,
    })
    .click();
  await content.getByRole("button", { name: "Task details", exact: true }).click();
  await detail.getByText("Conversation continued", { exact: true }).waitFor();
  await page.evaluate((id) => {
    window.__tasks.events.push({
      sequence: 5,
      taskId: id,
      runSeq: 3,
      at: 4,
      type: "conversation-continued",
    });
    window.__tasks.tasks.find((task) => task.id === id).updatedAt = Date.now() + 1;
    window.__tasks.notify();
  }, tasks[0].id);
  await detail.locator("ol li").filter({ hasText: "5Conversation continued" }).waitFor();
  assert.equal(await detail.getByText("Conversation continued", { exact: true }).count(), 2);
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^(start|create|update|complete|merge|archive|cancel|acp-create|acp-prompt)$/.test(call.op),
      ),
    ),
    false,
  );
  process.stdout.write(
    "PASS: API/ACP details without feedback, localized continued events, original session/draft and zero writes; desktop/mobile, both languages/themes.\n",
  );
}
