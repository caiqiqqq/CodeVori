import assert from "node:assert/strict";
import { join } from "node:path";
export async function exerciseWorkTaskResult(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const dialog = page.getByTestId("work-task-completion-dialog");
  const fill = () => dialog.getByTestId("work-task-ai-fill");
  const comment = () => dialog.getByTestId("work-task-forge-comment");
  const open = async (task) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await panel.locator(`[data-task-id="${task.id}"]`).click();
    await panel.getByTestId("work-task-complete").click();
    await dialog.waitFor();
  };
  const seed = async (kind) =>
    page.evaluate((kind) => {
      window.__tasks.acceptanceChanges = true;
      return window.__tasks.seed({
        title: "修复议题处理配置",
        prompt: "复用智能体与模式配置",
        status: "review",
        runSeq: 2,
        session: { kind, id: "bound-result-session" },
        execution:
          kind === "acp"
            ? { kind: "acp", agent: "codex", config: [] }
            : {
                kind: "api",
                modelSelection: { providerId: "test", modelId: "model" },
                mode: "build",
              },
        source: {
          repositoryKey: "github:forge.invalid/team/project",
          remoteName: "origin",
          accountId: "00000000-0000-4000-8000-000000000001",
          kind: "issue",
          number: 52,
          url: "https://forge.invalid/team/project/issues/52",
          title: "修复议题处理配置",
        },
        sourceBranch: "main",
        worktree: {
          path: "/synthetic/trees/result",
          projectPath: "/synthetic/project",
          branchName: "task/result",
          baseCommit: "base",
        },
      });
    }, kind);
  for (const kind of ["api", "acp"]) {
    await page.reload();
    await panel.getByTestId("work-task-board").waitFor();
    const task = await seed(kind);
    await open(task);
    await dialog.getByTestId("work-task-completion-accept").click();
    assert.equal(await dialog.getByTestId("work-task-forge-close").isVisible(), true);
    await fill().click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="work-task-forge-comment"]')?.value.includes("处理结果"),
    );
    assert.match(await comment().inputValue(), /主要修改/);
    const calls = await page.evaluate(() => window.__tasks.resultCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, "accept");
    assert.equal(calls[0].id, task.id);
    assert.equal(calls[0].runSeq, 2);
    assert.equal(calls[0].workspacePath, "/synthetic/project");
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.filter((c) => /^(complete|merge|forge-)/.test(c.op)).length,
      ),
      0,
    );
    await comment().fill("我的验收结果");
    await fill().click();
    await dialog.getByTestId("work-task-ai-replace").waitFor();
    assert.equal((await page.evaluate(() => window.__tasks.resultCalls)).length, 1);
    await dialog.getByTestId("work-task-ai-replace").getByText("取消", { exact: true }).click();
    assert.equal(await comment().inputValue(), "我的验收结果");
    await fill().click();
    await page.evaluate(() => {
      window.__tasks.failResult = true;
    });
    await dialog.getByText("替换并生成", { exact: true }).click();
    await dialog.getByText("没有可用的 API 摘要模型，请先配置模型。", { exact: true }).waitFor();
    assert.equal(await comment().inputValue(), "我的验收结果");
    await fill().click();
    await dialog.getByText("替换并生成", { exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="work-task-forge-comment"]')?.value.includes("处理结果"),
    );
    for (const [locale, width, theme] of [
      ["zh-CN", 1280, "zai-light"],
      ["zh-CN", 320, "zai-dark"],
      ["en-US", 320, "zai-light"],
    ]) {
      await page.evaluate(
        ({ locale, theme }) => {
          window.__tasks.setLocale(locale);
          document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
          document.body.classList.add("text-foreground");
        },
        { locale, theme },
      );
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({
        path: join(artifacts, `ai-result-${kind}-${locale}-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
    await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
    await dialog.getByTestId("work-task-completion-merge").click();
    await fill().click();
    await dialog.getByText("替换并生成", { exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="work-task-forge-comment"]')?.disabled,
    );
    assert.equal((await page.evaluate(() => window.__tasks.resultCalls)).at(-1).mode, "merge");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.className = "theme-zai-light";
    });
    await page.screenshot({
      path: join(artifacts, `ai-merge-${kind}-desktop.png`),
      animations: "disabled",
    });
    await dialog.getByTestId("work-task-completion-accept").click();
    await dialog.getByTestId("work-task-confirm-complete").click();
    await dialog.waitFor({ state: "hidden" });
    const complete = await page.evaluate(() =>
      window.__tasks.calls.find((c) => c.op === "complete"),
    );
    assert.match(complete.forge.comment, /处理结果/);
    assert.equal(complete.forge.closeIssue, true);
  }
  await page.reload();
  await panel.getByTestId("work-task-board").waitFor();
  const task = await seed("api");
  await open(task);
  await page.evaluate(() => {
    window.__tasks.delayResult = true;
  });
  await fill().click();
  await dialog.getByTestId("work-task-ai-cancel").waitFor();
  assert.equal(await dialog.getByTestId("work-task-confirm-complete").isDisabled(), true);
  assert.equal(await dialog.getByTestId("work-task-completion-accept").isDisabled(), true);
  assert.equal(await dialog.getByTestId("work-task-completion-merge").isDisabled(), true);
  assert.equal(await dialog.getByTestId("work-task-forge-close").isDisabled(), true);
  await dialog.getByTestId("work-task-ai-cancel").click();
  await comment().fill("保留取消后的内容");
  await page.evaluate(() => {
    window.__tasks.finishResult();
  });
  assert.equal(await comment().inputValue(), "保留取消后的内容");
  assert.equal((await page.evaluate(() => window.__tasks.resultCalls)).at(-1).op, "cancel");
  await fill().click();
  await dialog.getByText("替换并生成", { exact: true }).click();
  await dialog.getByTestId("work-task-ai-cancel").waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(() => {
    window.__tasks.finishResult();
    window.__tasks.delayResult = false;
  });
  await open(task);
  assert.equal(await comment().inputValue(), "任务结果已验收。");
  await page.evaluate(() => {
    window.__tasks.delayResult = true;
  });
  await fill().click();
  await dialog.getByTestId("work-task-ai-cancel").waitFor();
  await page.evaluate((id) => {
    window.__tasks.tasks.find((t) => t.id === id).runSeq++;
    window.__tasks.changed();
  }, task.id);
  await page.waitForFunction(() => window.__tasks.resultCalls.at(-1).op === "cancel");
  await page.evaluate(() => {
    window.__tasks.finishResult();
  });
  assert.equal(await comment().inputValue(), "任务结果已验收。");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate((id) => {
    const t = window.__tasks.tasks.find((t) => t.id === id);
    t.status = "queued";
    t.merge = { id: "merge", phase: "queued", targetBranch: "main" };
    window.__tasks.changed();
  }, task.id);
  const processing = panel.locator('[data-work-task-column="inProgress"]');
  await processing.locator(`[data-task-id="${task.id}"]`).waitFor();
  assert.match(await processing.innerText(), /处理中/);
  assert.match(await processing.innerText(), /等待合并/);
  process.stdout.write(
    "PASS: AI result drafts for API/ACP, both completion options, replace confirmation, failure, cancel/late responses, zero implicit writes, processing queue and responsive themes.\n",
  );
}
