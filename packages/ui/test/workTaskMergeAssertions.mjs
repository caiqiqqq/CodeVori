import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskBranchesAndMerge(page, artifacts) {
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const content = panel.getByTestId("work-task-content");
  const review = page.getByTestId("work-task-review-fixture");
  const merge = review.getByTestId("work-task-merge-controls");
  const editor = page.getByTestId("work-task-editor");
  const detail = page.getByTestId("work-task-detail");
  const card = (id) => panel.locator(`[data-testid="work-task-card"][data-task-id="${id}"]`);
  const longBranch = `feature/${"long-source-and-target-".repeat(8)}`;
  const noAgentCalls = async () =>
    assert.deepEqual(
      await page.evaluate(() =>
        window.__tasks.calls.filter((call) =>
          /^acp-(create|prompt|refresh|setConfigOption|manageAgent|updateAgent)$/.test(call.op),
        ),
      ),
      [],
    );
  const selectBranch = async (trigger, name) => {
    await trigger.click();
    await page.getByRole("option", { name, exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
  };
  const captureLayouts = async (surface, name) => {
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        await page.mouse.move(0, 0);
        // 分栏投影仍需完成；合并控件在独立侧栏，不改变对话组件身份。
        await page.waitForFunction(() => {
          const group = document.getElementById("work-task-workbench");
          const visible = Array.from(group.children).find(
            (element) => element.hasAttribute("data-panel") && !element.hidden,
          );
          const wide = group.clientWidth >= 768;
          return (
            group.dataset.wide === String(wide) &&
            (wide || Math.abs(visible.clientWidth - group.clientWidth) <= 1)
          );
        });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        assert.equal(
          await surface.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
          `${name} must fit ${width}px`,
        );
        if (await surface.getByTestId("work-task-source-branch").count())
          assert.equal(
            (await surface.getByTestId("work-task-source-branch").boundingBox()).height,
            28,
            "source branch picker must keep its existing sizing",
          );
        if (await surface.getByTestId("work-task-merge").count()) {
          const command = surface.getByTestId("work-task-merge");
          const bounds = await surface.boundingBox();
          const target = await surface.getByTestId("work-task-merge-target").boundingBox();
          const action = await surface.getByTestId("work-task-merge").boundingBox();
          for (const control of [target, action]) {
            assert.ok(control?.width > 0 && control.height > 0);
            assert.equal(control.height, 32, "merge controls must share the 32px sizing token");
            assert.ok(
              control.x >= bounds.x && control.x + control.width <= bounds.x + bounds.width + 1,
            );
          }
          assert.ok(
            action.x >= target.x + target.width - 1 || action.y >= target.y + target.height - 1,
            "merge target and action must not overlap",
          );
          assert.equal(
            await command.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
            "8px",
          );
          if (width === 1280) assert.equal(action.y, target.y, "merge controls must align");
          if (!(await command.isDisabled())) {
            const background = await command.evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            );
            await command.hover();
            await command.screenshot({
              path: join(artifacts, `${name}-${theme}-${width}-hover.png`),
            });
            assert.deepEqual(
              await command.boundingBox(),
              action,
              "hover must not shift the button",
            );
            assert.notEqual(
              await command.evaluate((element) => getComputedStyle(element).backgroundColor),
              background,
              "hover must provide visible color feedback",
            );
            await page.mouse.move(0, 0);
          }
        }
        if (await surface.getByTestId("work-task-fixture-session").count()) {
          assert.ok(
            (await surface.getByTestId("work-task-fixture-session").boundingBox()).height >= 160,
            "merge journal must leave room for the conversation",
          );
        }
        if (surface === merge && (await merge.getByRole("alert").count())) {
          const band = await merge.boundingBox();
          const error = await merge.getByRole("alert").boundingBox();
          assert.ok(
            error.y >= band.y && error.y + error.height <= band.y + band.height + 1,
            "merge failure must remain visible before long journal records",
          );
        }
        await page.screenshot({ path: join(artifacts, `${name}-${theme}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
  };
  await panel.getByTestId("work-task-new").click();

  await editor.getByTestId("work-task-prompt").fill("Task with a selected source branch");
  await page
    .waitForFunction(() =>
      document
        .querySelector('[data-testid="work-task-source-branch"]')
        ?.textContent.includes("main"),
    )
    .catch(async (error) => {
      process.stderr.write(
        JSON.stringify(
          await page.evaluate(() => ({
            branchReads: window.__tasks.gitReads,
            branches: window.__tasks.gitBranches,
            current: window.__tasks.currentBranch,
            trigger: document.querySelector('[data-testid="work-task-source-branch"]')?.outerHTML,
          })),
        ) + "\n",
      );
      throw error;
    });
  await page.evaluate((longBranch) => {
    window.__tasks.gitBranches = [
      "main",
      "release",
      ...Array.from({ length: 30 }, (_, i) => `feature/option-${i}`),
      longBranch,
    ];
  }, longBranch);
  await selectBranch(editor.getByTestId("work-task-source-branch"), longBranch);
  await captureLayouts(editor, "source-branch");
  await noAgentCalls();
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) => ["create", "start", "merge"].includes(call.op)),
    ),
    false,
  );
  await page.evaluate(() => {
    window.__tasks.failSave = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.ok((await editor.getByTestId("work-task-source-branch").innerText()).includes(longBranch));
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__tasks.tasks[0].sourceBranch), longBranch);
  assert.equal(await page.evaluate(() => window.__tasks.tasks[0].worktree), undefined);

  for (const kind of ["api", "acp"]) {
    const task = await page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Review ${kind}`,
          prompt: "Resolve review task",
          status: "review",
          sourceBranch: "release",
          runSeq: 1,
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          session: { kind, id: `original-${kind}` },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/${kind}`,
            baseCommit: "abcdef",
          },
        }),
      kind,
    );
    await card(task.id).getByRole("button", { name: task.title, exact: true }).click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    assert.equal(await detail.count(), 0, "merging must not require the details dialog");
    assert.equal(await content.getByTestId("work-task-merge-controls").count(), 0);
    assert.equal(await review.count(), 0, "selecting a task must not open the review pane");
    await content.getByTestId("side-pane-toggle").click();
    await merge.getByTestId("work-task-merge-target").waitFor();
    assert.ok((await merge.getByTestId("work-task-merge-target").innerText()).includes("release"));
    const originalSession = await content.getByTestId("work-task-fixture-session").elementHandle();
    const draft = content.getByRole("textbox", {
      name: "Synthetic conversation draft",
      exact: true,
    });
    await draft.fill(`Review draft ${kind}`);
    await page.evaluate((branchName) => {
      window.__tasks.gitBranches.push(branchName);
    }, task.worktree.branchName);
    await merge.getByTestId("work-task-merge-target").click();
    assert.equal(
      await page.getByRole("option", { name: task.worktree.branchName, exact: true }).count(),
      0,
    );
    await page.getByRole("option", { name: longBranch, exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await captureLayouts(merge, `merge-target-${kind}`);
    await review.getByRole("button", { name: "关闭审查面板", exact: true }).click();
    await review.waitFor({ state: "detached" });
    assert.equal(await draft.inputValue(), `Review draft ${kind}`);
    await content.getByTestId("side-pane-toggle").click();
    await merge.getByTestId("work-task-merge-target").waitFor();
    assert.ok(
      (await merge.getByTestId("work-task-merge-target").innerText()).includes(longBranch),
      "closing the review tab must not discard the branch draft",
    );
    const mergeCalls = await page.evaluate(() =>
      window.__tasks.calls.filter((call) => call.op === "merge"),
    );
    await page.evaluate((id) => {
      window.__tasks.tasks.find((task) => task.id === id).stopPending = true;
      window.__tasks.notify();
    }, task.id);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="work-task-merge"]')?.disabled === true,
    );
    assert.ok(await merge.getByTestId("work-task-merge-target").isDisabled());
    await captureLayouts(merge, `merge-disabled-${kind}`);
    assert.deepEqual(
      await page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "merge")),
      mergeCalls,
      "disabled preview must not submit a merge",
    );
    await page.evaluate((id) => {
      window.__tasks.tasks.find((task) => task.id === id).stopPending = false;
      window.__tasks.notify();
    }, task.id);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="work-task-merge"]')?.disabled === false,
    );
    await content.getByRole("button", { name: "任务详情", exact: true }).click();
    await detail.waitFor();
    assert.equal(await detail.getByTestId("work-task-merge-target").count(), 0);
    assert.equal(await detail.getByTestId("work-task-merge").count(), 0);
    assert.equal(await page.getByTestId("work-task-merge-controls").count(), 1);
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });
    assert.ok((await merge.getByTestId("work-task-merge-target").innerText()).includes(longBranch));
    assert.equal(await draft.inputValue(), `Review draft ${kind}`);
    assert.equal(
      await page.evaluate(
        (element) =>
          element === document.querySelector('[data-testid="work-task-fixture-session"]'),
        originalSession,
      ),
      true,
      "details and resizing must not remount the conversation",
    );
    await originalSession.dispose();
    await noAgentCalls();
    if (kind === "api") {
      await page.evaluate(() => {
        window.__tasks.failMerge = true;
      });
      await merge.getByTestId("work-task-merge").click();
      await merge.getByRole("alert").waitFor();
      assert.ok((await merge.getByRole("alert").innerText()).includes("未提交改动"));
      assert.ok(
        (await merge.getByTestId("work-task-merge-target").innerText()).includes(longBranch),
      );
    }
    await merge.getByTestId("work-task-merge").click();
    await merge.getByText("等待合并", { exact: true }).waitFor();
    assert.equal(await merge.getByTestId("work-task-merge").count(), 0);
    await page.evaluate((id) => window.__tasks.advanceMerge(id, "resolving"), task.id);
    await merge.getByText("合并处理中", { exact: true }).waitFor();
    const resolverPath = `/synthetic/trees/merge-${task.id}/project`;
    await assertWorkTaskSessionTarget(panel, kind, `resolver-${task.id}`, resolverPath);
    assert.equal(
      await panel.getByTestId("work-task-fixture-session").getAttribute("data-readonly"),
      "false",
    );
    assert.ok(await panel.getByTestId("work-task-toggle-merge-conversation").isDisabled());
    assert.equal(await page.evaluate(() => window.__tasks.toolTarget?.workspacePath), resolverPath);
    await page.evaluate((id) => window.__tasks.advanceMerge(id, "applying"), task.id);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="work-task-fixture-session"]')
          ?.getAttribute("data-readonly") === "true",
    );
    await content.getByRole("button", { name: "任务操作", exact: true }).click();
    assert.ok(await page.getByRole("menuitem", { name: "取消执行", exact: true }).isDisabled());
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.evaluate(({ id, phase }) => window.__tasks.advanceMerge(id, phase), {
      id: task.id,
      phase: kind === "api" ? "failed" : "merged",
    });
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    assert.equal(await merge.getByTestId("work-task-merge").count(), kind === "api" ? 1 : 0);
    if (kind === "api") {
      await page.evaluate((id) => {
        window.__tasks.tasks.find((task) => task.id === id).merge.conflicts = Array.from(
          { length: 40 },
          (_, index) => `src/${"long-conflict-file-".repeat(4)}${index}.ts`,
        );
        window.__tasks.notify();
      }, task.id);
      await captureLayouts(merge, "merge-journal-api");
      assert.ok(
        await merge.evaluate((element) => element.scrollHeight > element.clientHeight),
        "long merge records must scroll above the file changes",
      );
    }
    await panel.getByTestId("work-task-toggle-merge-conversation").click();
    await assertWorkTaskSessionTarget(panel, kind, `resolver-${task.id}`, resolverPath);
    assert.equal(
      await panel.getByTestId("work-task-fixture-session").getAttribute("data-readonly"),
      "true",
    );
    await captureLayouts(panel, `resolver-${kind}`);
    await panel.getByTestId("work-task-toggle-merge-conversation").click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    await noAgentCalls();
    if (kind === "api") {
      await page.waitForFunction(
        (branch) =>
          document
            .querySelector('[data-testid="work-task-merge-target"]')
            ?.textContent.includes(branch),
        longBranch,
      );
      await merge.getByTestId("work-task-merge").click();
      await merge.getByText("等待合并", { exact: true }).waitFor();
      await content.getByRole("button", { name: "任务操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "取消执行", exact: true }).click();
      await page.getByRole("menu").waitFor({ state: "detached" });
      await merge.getByText("合并已取消", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          (id) => window.__tasks.tasks.find((task) => task.id === id).status,
          task.id,
        ),
        "review",
      );
      await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    }
    await review.getByRole("button", { name: "关闭审查面板", exact: true }).click();
    await review.waitFor({ state: "detached" });
    await card("task-0")
      .getByRole("button", { name: "Task with a selected source branch", exact: true })
      .click();
    assert.equal(await page.getByTestId("work-task-merge-controls").count(), 0);
  }
}
