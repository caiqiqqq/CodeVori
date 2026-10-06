import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskCompletion(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const content = panel.getByTestId("work-task-content");
  const confirm = page.getByTestId("work-task-completion-dialog");
  const card = (id) => panel.locator(`[data-testid="work-task-card"][data-task-id="${id}"]`);
  const completeCount = () =>
    page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "complete").length);
  const menuComplete = async (id) => {
    await card(id).getByRole("button", { name: "任务操作", exact: true }).click();
    await page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "确认完成", exact: true })
      .click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await confirm.waitFor();
  };
  const setStatus = (id, status, patch = {}) =>
    page.evaluate(
      ({ id, status, patch }) => {
        Object.assign(
          window.__tasks.tasks.find((task) => task.id === id),
          patch,
        );
        window.__tasks.status(id, status);
      },
      { id, status, patch },
    );
  const seed = (kind, title, binding = true) =>
    page.evaluate(
      ({ kind, title, binding }) =>
        window.__tasks.seed({
          title,
          prompt: "Review the completed work",
          status: "review",
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          ...(binding
            ? {
                session: { kind, id: `completion-${title}` },
                worktree: {
                  rootPath: "/synthetic/trees",
                  path: `/synthetic/trees/${title}/project`,
                  projectPath: "/synthetic/project",
                  branchName: `worktree/${title}`,
                  baseCommit: "abcdef",
                },
              }
            : {}),
        }),
      { kind, title, binding },
    );

  for (const kind of ["api", "acp"]) {
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 850 });
    await panel.getByTestId("work-task-board").waitFor();
    const task = await seed(kind, `Complete ${kind}`);
    const other = await seed(kind, `Unselected ${kind}`);
    await card(task.id).getByRole("button", { name: task.title, exact: true }).click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    const session = panel.getByTestId("work-task-fixture-session");
    const previous = await session.elementHandle();
    const draft = session.getByRole("textbox", { name: "Synthetic conversation draft" });
    await draft.fill("Keep this draft");
    const complete = content.getByTestId("work-task-complete");
    await complete.waitFor();
    await page.screenshot({
      animations: "disabled",
      path: join(artifacts, `completion-header-${kind}-desktop.png`),
    });
    await content.getByRole("button", { name: "任务详情", exact: true }).click();
    const detail = page.getByTestId("work-task-detail");
    await detail.waitFor();
    assert.equal(await detail.getByRole("button", { name: "确认完成", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });

    await complete.click();
    await confirm.waitFor();
    assert.equal(await confirm.getByTestId("work-task-completion-title").innerText(), task.title);
    assert.equal(await completeCount(), 0);
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "detached" });
    assert.equal(await completeCount(), 0);
    await menuComplete(other.id);
    assert.equal(await confirm.getByTestId("work-task-completion-title").innerText(), other.title);
    assert.equal(await card(task.id).getAttribute("data-selected"), "true");
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    assert.equal(await completeCount(), 0);

    await complete.click();
    await confirm.waitFor();
    await page.evaluate(() => {
      window.__tasks.failComplete = true;
    });
    await confirm.getByTestId("work-task-confirm-complete").click();
    await confirm.getByRole("alert").waitFor();
    assert.equal(await confirm.getByRole("alert").innerText(), "Synthetic completion failed");
    assert.equal(await completeCount(), 1);
    await page.evaluate(() => {
      window.__tasks.delayComplete = true;
    });
    await confirm.getByTestId("work-task-confirm-complete").evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.__tasks.pendingCompletions.length === 1);
    assert.equal(await completeCount(), 2, "same-frame double click must submit only once");
    assert.equal(await confirm.getByTestId("work-task-confirm-complete").isDisabled(), true);
    assert.equal(
      await confirm.getByRole("button", { name: "取消", exact: true }).isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await confirm.isVisible(), true);
    await page.evaluate(() => window.__tasks.finishComplete());
    await confirm.waitFor({ state: "detached" });
    await panel
      .locator('[data-work-task-column="done"]')
      .locator(`[data-task-id="${task.id}"]`)
      .waitFor();
    assert.equal(await complete.count(), 0);
    assert.equal(await previous.evaluate((element) => element.isConnected), true);
    assert.equal(await draft.inputValue(), "Keep this draft");
    const result = await page.evaluate(
      (id) => window.__tasks.tasks.find((task) => task.id === id),
      task.id,
    );
    assert.equal(result.completion, "accepted_without_merge");
    assert.deepEqual(result.session, task.session);
    assert.deepEqual(result.worktree, task.worktree);

    await menuComplete(other.id);
    await confirm.getByTestId("work-task-confirm-complete").click();
    await confirm.waitFor({ state: "detached" });
    await panel
      .locator('[data-work-task-column="done"]')
      .locator(`[data-task-id="${other.id}"]`)
      .waitFor();
    assert.equal(await card(task.id).getAttribute("data-selected"), "true");
    assert.equal(await previous.evaluate((element) => element.isConnected), true);
    assert.equal(await draft.inputValue(), "Keep this draft");
    await previous.dispose();

    const guard = await seed(kind, "Guard completion", false);
    await card(guard.id).getByRole("button", { name: guard.title, exact: true }).click();
    for (const status of [
      "todo",
      "queued",
      "preparing",
      "running",
      "awaiting_input",
      "failed",
      "done",
    ]) {
      await setStatus(guard.id, status);
      await content.locator(`[data-work-task-status="${status}"]`).waitFor();
      assert.equal(await complete.count(), 0, status);
      await card(guard.id).getByRole("button", { name: "任务操作", exact: true }).click();
      assert.equal(
        await page.getByRole("menuitem", { name: "确认完成", exact: true }).count(),
        0,
        status,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
    }
    for (const patch of [
      { stopPending: true },
      {
        stopPending: false,
        merge: {
          id: "merge",
          phase: "applying",
          targetBranch: "main",
          projectPath: "/synthetic/project",
        },
      },
    ]) {
      await setStatus(guard.id, "review", patch);
      await content.locator('[data-work-task-status="review"]').waitFor();
      assert.equal(await complete.count(), 0);
    }
    await setStatus(guard.id, "review", { merge: undefined });
    await complete.waitFor();
    await complete.click();
    await confirm.waitFor();
    const beforeInvalidation = await completeCount();
    await setStatus(guard.id, "running");
    await confirm.waitFor({ state: "detached" });
    assert.equal(await completeCount(), beforeInvalidation);
    await setStatus(guard.id, "review");

    for (const locale of ["zh-CN", "en-US"]) {
      await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.className =
            theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
        }, theme);
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 850 });
          await page.waitForFunction(() => {
            const group = document.getElementById("work-task-workbench");
            const visible = Array.from(group.children).find(
              (element) => element.hasAttribute("data-panel") && !element.hidden,
            );
            return (
              group.dataset.wide === String(group.clientWidth >= 768) &&
              (group.clientWidth >= 768 || Math.abs(visible.clientWidth - group.clientWidth) <= 1)
            );
          });
          assert.equal(await complete.isVisible(), true);
          assert.equal(
            await content.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
            false,
          );
          await page.screenshot({
            animations: "disabled",
            path: join(artifacts, `completion-header-${kind}-${locale}-${theme}-${width}.png`),
          });
          await complete.click();
          await confirm.waitFor();
          assert.equal(
            await confirm.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
            false,
          );
          await page.screenshot({
            animations: "disabled",
            path: join(artifacts, `completion-${kind}-${locale}-${theme}-${width}.png`),
          });
          await page.keyboard.press("Escape");
          await confirm.waitFor({ state: "detached" });
        }
      }
    }
    await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
    await complete.click();
    await confirm.waitFor();
    await setStatus(guard.id, "review", { archived: true });
    await confirm.waitFor({ state: "detached" });
    assert.equal(await completeCount(), beforeInvalidation);
    await setStatus(guard.id, "review", { archived: false });
    await page.setViewportSize({ width: 1280, height: 850 });
    await card(guard.id).getByRole("button", { name: guard.title, exact: true }).click();
    await menuComplete(guard.id);
    await confirm.getByTestId("work-task-confirm-complete").click();
    await confirm.waitFor({ state: "detached" });
    assert.equal(await content.locator('[data-work-task-status="done"]').count(), 1);

    const scoped = await seed(kind, "Scoped completion", false);
    await card(scoped.id).getByRole("button", { name: scoped.title, exact: true }).click();
    await complete.click();
    await confirm.waitFor();
    const beforeScopeChange = await completeCount();
    await page.evaluate(() => window.__tasks.setWorkspace("none"));
    await confirm.waitFor({ state: "detached" });
    assert.equal(await completeCount(), beforeScopeChange);
    assert.deepEqual(
      await page.evaluate(() =>
        window.__tasks.calls.filter((call) =>
          /^(start|create|update|merge|acp-create|acp-prompt)$/.test(call.op),
        ),
      ),
      [],
    );
  }
  process.stdout.write(
    "PASS: external API/ACP completion, one confirmation, cancel, failure/retry, duplicate-click prevention, state/scope invalidation, unselected task isolation, preserved worktree/session/draft and bilingual responsive themes.\n",
  );
}
