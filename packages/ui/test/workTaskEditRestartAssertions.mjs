import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskEditRestart(page, artifacts) {
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 850 });
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  await panel.getByTestId("work-task-board").waitFor();
  const card = (task) => panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
  const writes = (task) =>
    page.evaluate(
      (id) =>
        window.__tasks.calls.filter((call) => call.id === id && /^(update|start)$/.test(call.op)),
      task.id,
    );
  const edit = async (task) => {
    await card(task).getByRole("button", { name: "任务操作", exact: true }).click();
    await page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "编辑任务", exact: true })
      .click();
    await editor.waitFor();
  };
  for (const kind of ["api", "acp"]) {
    const task = await page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Failed ${kind} task`,
          prompt: "Original instructions",
          status: "failed",
          runSeq: 1,
          failureReason: "Synthetic previous failure",
          execution:
            kind === "api"
              ? {
                  kind,
                  modelSelection: {
                    providerId: "api",
                    modelId: "TestModel",
                    options: { reasoningLevel: "high" },
                  },
                  mode: "build",
                }
              : { kind, agent: "codex", config: [{ configId: "fast", value: false }] },
          session: { kind, id: `retained-${kind}-session` },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/retained-${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/retained-${kind}`,
            baseCommit: "abcdef",
          },
        }),
      kind,
    );
    await card(task).getByRole("button", { name: task.title, exact: true }).click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    await edit(task);
    assert.equal(await editor.getByTestId("work-task-save").innerText(), "保存并重新开始");
    await editor.getByTestId("work-task-prompt").fill(`Edited ${kind} instructions`);
    if (kind === "api") {
      await page.evaluate(() => {
        window.__tasks.delaySave = true;
        window.__tasks.delayStart = true;
        const form = document.querySelector('[data-testid="work-task-editor"] form');
        form.requestSubmit();
        form.requestSubmit();
      });
      await page.waitForFunction(() => window.__tasks.pendingSaves.length === 1);
      assert.deepEqual(
        (await writes(task)).map((call) => call.op),
        ["update"],
      );
      assert.ok(await editor.getByTestId("work-task-save").isDisabled());
      assert.ok(await editor.getByRole("button", { name: "取消", exact: true }).isDisabled());
      assert.equal(
        await editor.getByTestId("work-task-prompt").getAttribute("contenteditable"),
        "false",
      );
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.className =
            theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
        }, theme);
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 850 });
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
            await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
            false,
          );
          assert.equal(
            await editor
              .getByTestId("work-task-save")
              .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
            false,
          );
          await page.screenshot({ path: join(artifacts, `edit-restart-${theme}-${width}.png`) });
        }
      }
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.evaluate(() => window.__tasks.finishSave());
      await page.waitForFunction(() => window.__tasks.pendingStarts.length === 1);
      assert.deepEqual(
        (await writes(task)).map((call) => call.op),
        ["update", "start"],
      );
      assert.ok(await editor.getByTestId("work-task-save").isDisabled());
      assert.ok(await editor.getByRole("button", { name: "取消", exact: true }).isDisabled());
      await page.evaluate(() => {
        document.querySelector('[data-testid="work-task-editor"] form').requestSubmit();
        window.__tasks.finishStart();
      });
    } else {
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      await editor.waitFor({ state: "detached" });
      assert.deepEqual(await writes(task), [], "canceling an edit must not save or start");
      await edit(task);
      await editor.getByTestId("work-task-prompt").fill(`Edited ${kind} instructions`);
      await page.evaluate(() => {
        window.__tasks.failSave = true;
      });
      await editor.getByTestId("work-task-save").click();
      await editor.getByRole("alert").waitFor();
      assert.equal(await editor.getByRole("alert").innerText(), "Synthetic save failed");
      assert.equal(
        await editor.getByTestId("work-task-prompt").innerText(),
        `Edited ${kind} instructions`,
      );
      assert.deepEqual(
        (await writes(task)).map((call) => call.op),
        ["update"],
      );
      await editor.getByTestId("work-task-save").click();
    }
    await editor.waitFor({ state: "detached" });
    await card(task).locator('[data-work-task-status="running"]').waitFor();
    const saved = await page.evaluate(
      (id) => window.__tasks.tasks.find((task) => task.id === id),
      task.id,
    );
    assert.equal(saved.prompt, `Edited ${kind} instructions`);
    assert.equal(saved.runText, saved.prompt);
    assert.equal(saved.runSeq, 2);
    assert.deepEqual(saved.execution, task.execution);
    assert.deepEqual(saved.session, task.session);
    assert.deepEqual(saved.worktree, task.worktree);
    assert.equal(saved.failureReason, undefined);
    assert.equal((await writes(task)).filter((call) => call.op === "start").length, 1);
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
  }

  const todo = await page.evaluate(() =>
    window.__tasks.seed({ title: "Unstarted edit", prompt: "Before edit" }),
  );
  await edit(todo);
  await editor.getByTestId("work-task-prompt").fill("Start after editing todo");
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  await card(todo).locator('[data-work-task-status="running"]').waitFor();
  assert.deepEqual(
    (await writes(todo)).map((call) => call.op),
    ["update", "start"],
  );

  const orphan = await page.evaluate(() => {
    const task = window.__tasks.seed({
      workspacePath: "/synthetic/default",
      title: "Non-executable edit",
      prompt: "Keep without running",
      status: "failed",
    });
    window.__tasks.setWorkspace("none");
    return task;
  });
  await edit(orphan);
  assert.equal(await editor.getByTestId("work-task-save").innerText(), "保存");
  await editor.getByTestId("work-task-prompt").fill("Save without a project");
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  assert.deepEqual(
    (await writes(orphan)).map((call) => call.op),
    ["update"],
  );
  assert.equal(
    await page.evaluate(() => window.__tasks.calls.some((call) => call.op === "create")),
    false,
  );
}
