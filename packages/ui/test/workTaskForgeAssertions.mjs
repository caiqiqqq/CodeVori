import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskForge(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const dialog = page.getByTestId("work-task-completion-dialog");
  const seed = async (kind) =>
    page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Linked ${kind} issue`,
          prompt: "Fix the issue",
          status: "review",
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          source: {
            repositoryKey: "github:forge.invalid/team/project",
            remoteName: "origin",
            accountId: "00000000-0000-4000-8000-000000000001",
            kind: "issue",
            number: 7,
            title: "Synthetic issue",
            url: "https://forge.invalid/team/project/issues/7",
          },
        }),
      kind,
    );
  const select = async (task) =>
    panel
      .locator(`[data-task-id="${task.id}"]`)
      .getByRole("button", { name: task.title, exact: true })
      .click();
  const count = () =>
    page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "complete").length);
  for (const kind of ["api", "acp"]) {
    for (const [width, theme] of [
      [1280, "zai-light"],
      [320, "zai-dark"],
    ]) {
      await page.reload();
      await page.setViewportSize({ width, height: 850 });
      await panel.getByTestId("work-task-board").waitFor();
      await page.evaluate((theme) => {
        document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
        // 独立夹具没有 App 外壳，补齐实际外壳的前景色继承，避免暗色截图误用浏览器默认黑字。
        document.body.classList.add("text-foreground");
      }, theme);
      const task = await seed(kind);
      await select(task);
      await panel.getByTestId("work-task-complete").click();
      await dialog.waitFor();
      assert.equal(
        await dialog.getByTestId("work-task-forge-close").getAttribute("data-state"),
        "checked",
      );
      await dialog.getByTestId("work-task-forge-comment").fill("已验证修复，并完成回归检查。");
      assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({
        path: join(artifacts, `forge-complete-${kind}-${width}-${theme}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await count(), 0);
      await panel.getByTestId("work-task-complete").click();
      await dialog.getByTestId("work-task-forge-comment").fill("Confirmed result");
      await page.evaluate(() => {
        window.__tasks.failForgeClose = true;
      });
      await dialog.getByTestId("work-task-confirm-complete").click();
      await dialog.getByRole("alert").waitFor();
      const first = await page.evaluate(() =>
        window.__tasks.calls.filter((c) => c.op === "complete").at(-1),
      );
      assert.equal(first.workspacePath, "/synthetic/project");
      assert.deepEqual(first.forge, { closeIssue: true, comment: "Confirmed result" });
      await dialog.getByTestId("work-task-forge-receipts").waitFor();
      assert.match(
        await dialog.getByTestId("work-task-forge-receipts").innerText(),
        /成功.*\n.*失败/s,
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.evaluate(() => window.__tasks.remount());
      await panel.getByTestId("work-task-complete").waitFor();
      assert.equal(await panel.getByTestId("work-task-complete").innerText(), "重试议题同步");
      await panel.getByTestId("work-task-complete").click();
      await dialog.getByTestId("work-task-confirm-complete").click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(
          () => window.__tasks.calls.filter((c) => c.op === "forge-comment").length,
        ),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => window.__tasks.tasks.find((t) => t.id === window.__tasks.tasks.at(-1).id).status,
        ),
        "done",
      );
    }
  }
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 850 });
  await panel.getByTestId("work-task-board").waitFor();
  const task = await seed("api");
  await select(task);
  await panel.getByTestId("work-task-complete").click();
  await dialog.getByTestId("work-task-forge-close").click();
  await dialog.getByTestId("work-task-forge-send-comment").click();
  await dialog.getByTestId("work-task-confirm-complete").click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "complete").at(-1).forge),
    { closeIssue: false },
  );
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) => /^(forge-comment|forge-close|start|merge)$/.test(c.op)),
    ),
    false,
  );
  for (const [kind, width, theme] of [
    ["api", 1280, "zai-light"],
    ["acp", 320, "zai-dark"],
  ]) {
    await page.reload();
    await page.setViewportSize({ width, height: 850 });
    await panel.getByTestId("work-task-board").waitFor();
    const task = await seed(kind);
    await page.evaluate(
      ({ id, theme }) => {
        document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
        document.body.classList.add("text-foreground");
        Object.assign(
          window.__tasks.tasks.find((t) => t.id === id),
          {
            runSeq: 1,
            sourceBranch: "main",
            worktree: {
              rootPath: "/synthetic/trees",
              path: `/synthetic/trees/${id}/project`,
              projectPath: "/synthetic/project",
              branchName: `worktree/${id}`,
              baseCommit: "abcdef",
            },
          },
        );
        window.__tasks.notify();
      },
      { id: task.id, theme },
    );
    await select(task);
    await panel.getByTestId("work-task-content").getByTestId("side-pane-toggle").click();
    const merge = page.getByTestId("work-task-merge-controls");
    await merge.getByTestId("work-task-forge-options").waitFor();
    await merge.getByTestId("work-task-forge-comment").fill("Verified merge result");
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="work-task-merge"]')?.disabled,
    );
    assert.equal(await merge.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({
      path: join(artifacts, `forge-merge-${kind}-${width}-${theme}.png`),
      animations: "disabled",
    });
    await merge.getByTestId("work-task-merge").click();
    await merge.getByText("等待合并", { exact: true }).waitFor();
    const call = await page.evaluate(() => window.__tasks.calls.find((c) => c.op === "merge"));
    assert.equal(call.workspacePath, "/synthetic/project");
    assert.equal(call.targetBranch, "main");
    assert.deepEqual(call.forge, { closeIssue: true, comment: "Verified merge result" });
  }
  process.stdout.write(
    "PASS: linked API/ACP completion and merge options, cancel, pinned partial retry after remount, no duplicate comments, desktop/mobile and both themes.\n",
  );
}
