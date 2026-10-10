import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskAcceptance(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const dialog = page.getByTestId("work-task-completion-dialog");
  const submit = () => dialog.getByTestId("work-task-confirm-complete");
  const mergeChoice = () => dialog.getByTestId("work-task-completion-merge");
  const acceptChoice = () => dialog.getByTestId("work-task-completion-accept");
  const target = () => dialog.getByTestId("work-task-completion-target");
  const reset = async () => {
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 850 });
    await panel.getByTestId("work-task-board").waitFor();
  };
  const seed = (kind = "api", worktree = true) =>
    page.evaluate(
      ({ kind, worktree }) =>
        window.__tasks.seed({
          title: "修复议题提示的显示位置",
          prompt: "调整提示并完成验证",
          status: "review",
          runSeq: 1,
          sourceBranch: "release",
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          ...(worktree
            ? {
                worktree: {
                  rootPath: "/synthetic/trees",
                  path: "/synthetic/trees/task/project",
                  projectPath: "/synthetic/project",
                  branchName: "worktree/task",
                  baseCommit: "abcdef",
                },
              }
            : {}),
          source: {
            repositoryKey: "github:forge.invalid/team/project",
            remoteName: "origin",
            accountId: "00000000-0000-4000-8000-000000000001",
            kind: "issue",
            number: 52,
            title: "修复议题提示的显示位置",
            url: "https://forge.invalid/team/project/issues/52",
          },
        }),
      { kind, worktree },
    );
  const open = async (task) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await panel
      .locator(`[data-task-id="${task.id}"]`)
      .getByRole("button", { name: task.title, exact: true })
      .click();
    await panel.getByTestId("work-task-complete").click();
    await dialog.waitFor();
  };
  const cancel = async () => {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  };
  const writes = () =>
    page.evaluate(() =>
      window.__tasks.calls.filter((c) =>
        /^(merge|complete|forge-comment|forge-close|start|acp-create|acp-prompt)$/.test(c.op),
      ),
    );
  const expectReady = async () => {
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="work-task-confirm-complete"]')?.disabled,
    );
  };

  for (const kind of ["api", "acp"]) {
    await reset();
    await page.evaluate(() => {
      window.__tasks.acceptanceChanges = true;
    });
    const task = await seed(kind);
    await open(task);
    await expectReady();
    assert.equal(await mergeChoice().getAttribute("aria-pressed"), "true");
    assert.match(await target().innerText(), /release/);
    await dialog.getByTestId("work-task-forge-comment").fill("已修复提示位置，并完成回归检查。");
    for (const locale of ["zh-CN", "en-US"]) {
      await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
      for (const [width, theme] of [
        [1280, "zai-light"],
        [320, "zai-dark"],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => {
          document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
          document.body.classList.add("text-foreground");
        }, theme);
        assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        assert.equal(await submit().isVisible(), true);
        await page.screenshot({
          path: join(artifacts, `acceptance-${kind}-${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
    await cancel();
    assert.equal((await writes()).length, 0);
    await open(task);
    await expectReady();
    await page.evaluate(() => {
      window.__tasks.gitBranches.push("worktree/task");
    });
    await target().click();
    assert.equal(await page.getByRole("option", { name: "worktree/task", exact: true }).count(), 0);
    await page.getByRole("option", { name: "main", exact: true }).click();
    await dialog.getByTestId("work-task-forge-comment").fill("Accepted merge result");
    await page.evaluate(() => {
      window.__tasks.failMerge = true;
    });
    await submit().click();
    await dialog.getByRole("alert").waitFor();
    assert.match(await target().innerText(), /main/);
    assert.equal(
      await dialog.getByTestId("work-task-forge-comment").inputValue(),
      "Accepted merge result",
    );
    assert.equal(
      await page.evaluate((id) => window.__tasks.tasks.find((t) => t.id === id).status, task.id),
      "review",
    );
    await page.evaluate(() => {
      window.__tasks.delayMerge = true;
    });
    await submit().evaluate((b) => {
      b.click();
      b.click();
    });
    await page.waitForFunction(() => window.__tasks.pendingMerges.length === 1);
    assert.equal(await submit().isDisabled(), true);
    assert.equal(await acceptChoice().isDisabled(), true);
    assert.equal(await target().isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true);
    await page.evaluate(() => window.__tasks.finishMerge());
    await dialog.waitFor({ state: "detached" });
    const calls = await writes();
    assert.equal(
      calls.filter((c) => c.op === "merge").length,
      2,
      "one refused request, one accepted request",
    );
    assert.equal(calls.filter((c) => c.op === "complete").length, 0);
    const request = calls.at(-1);
    assert.equal(request.id, task.id);
    assert.equal(request.workspacePath, "/synthetic/project");
    assert.equal(request.targetBranch, "main");
    assert.deepEqual(request.forge, { closeIssue: true, comment: "Accepted merge result" });
    assert.equal(
      calls.some((c) => /^(forge-|start|acp-)/.test(c.op)),
      false,
    );
  }

  for (const situation of ["empty", "committed", "unknown", "missing"]) {
    await reset();
    await page.evaluate((situation) => {
      window.__tasks.acceptanceCommitted = situation === "committed";
      window.__tasks.failAcceptance = situation === "unknown";
      window.__tasks.missingWorktree = situation === "missing";
    }, situation);
    const task = await seed();
    await open(task);
    await expectReady();
    if (situation === "missing") {
      assert.equal(await mergeChoice().count(), 0);
    } else {
      assert.equal(
        await mergeChoice().getAttribute("aria-pressed"),
        situation === "empty" ? "false" : "true",
      );
      await acceptChoice().click();
    }
    if (situation === "empty") {
      await page.evaluate(() => {
        document.documentElement.className = "theme-zai-light";
        document.body.classList.add("text-foreground");
      });
      await page.screenshot({
        path: join(artifacts, "acceptance-empty-desktop.png"),
        animations: "disabled",
      });
    }
    assert.equal(await target().count(), 0);
    await submit().click();
    await dialog.waitFor({ state: "detached" });
    assert.equal((await writes()).filter((c) => c.op === "complete").length, 1);
    assert.equal((await writes()).filter((c) => c.op === "merge").length, 0);
  }

  await reset();
  await page.evaluate(() => {
    window.__tasks.delayAcceptance = true;
    window.__tasks.acceptanceChanges = true;
  });
  const delayed = await seed();
  await open(delayed);
  await page.waitForFunction(() => window.__tasks.pendingAcceptance.length === 4);
  assert.equal(await submit().isDisabled(), true);
  await acceptChoice().click();
  await page.evaluate(() => {
    window.__tasks.delayAcceptance = false;
    window.__tasks.finishAcceptance();
  });
  await dialog
    .getByTestId("work-task-acceptance-hint")
    .getByText("任务有改动或新增提交，建议合并后完成。", { exact: true })
    .waitFor();
  assert.equal(
    await acceptChoice().getAttribute("aria-pressed"),
    "true",
    "late read must preserve explicit choice",
  );
  await cancel();
  assert.equal((await writes()).length, 0);

  await reset();
  await page.evaluate(() => {
    window.__tasks.delayAcceptance = true;
  });
  const missingLate = await seed();
  await open(missingLate);
  await page.waitForFunction(() => window.__tasks.pendingAcceptance.length === 4);
  await mergeChoice().click();
  await page.evaluate(() => {
    window.__tasks.missingWorktree = true;
    window.__tasks.delayAcceptance = false;
    window.__tasks.finishAcceptance();
  });
  await dialog
    .getByTestId("work-task-acceptance-hint")
    .getByText("任务工作树已不可用，可确认完成并保留任务记录。", { exact: true })
    .waitFor();
  assert.equal(await mergeChoice().getAttribute("aria-pressed"), "true");
  assert.equal(
    await submit().isDisabled(),
    true,
    "late unavailable result must never convert merge into completion",
  );
  await acceptChoice().click();
  await expectReady();
  await cancel();
  assert.equal((await writes()).length, 0);

  await reset();
  await page.evaluate(() => {
    window.__tasks.acceptanceChanges = true;
  });
  const branchError = await seed();
  await open(branchError);
  await expectReady();
  await cancel();
  await page.evaluate(() => {
    window.__tasks.failBranches = true;
  });
  await open(branchError);
  await dialog.getByRole("alert").waitFor();
  assert.equal(await submit().isDisabled(), true);
  await acceptChoice().click();
  await expectReady();
  await cancel();
  await open(branchError);
  await expectReady();
  await page.evaluate(() => {
    window.__tasks.gitBranches = ["main"];
  });
  await target().click();
  await page.getByRole("option", { name: "main", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("listbox").waitFor({ state: "detached" });
  assert.equal(await submit().isDisabled(), true, "removed selected branch must block merge");
  await cancel();

  await reset();
  const unbound = await seed("api", false);
  await open(unbound);
  assert.equal(await mergeChoice().count(), 0);
  assert.equal(await page.evaluate(() => window.__tasks.acceptanceReads.length), 0);
  await cancel();
  process.stdout.write(
    "PASS: adaptive merge/plain acceptance, scoped commands, cancellation, failure and duplicate-submit guards, delayed and failed reads, branch removal, API/ACP and responsive bilingual themes.\n",
  );
}
