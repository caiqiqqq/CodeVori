import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertWorkTaskPendingChat(panel, { text, modelValue }) {
  const preview = panel.getByTestId("work-task-unstarted");
  const bubble = preview.locator('[data-v4-user-input-bubble="true"]');
  await bubble.waitFor();
  assert.equal(await bubble.innerText(), text);
  const input = preview.getByTestId("work-task-pending-input");
  await input.waitFor();
  assert.equal(await input.getAttribute("contenteditable"), "false");
  assert.equal(
    (await input.innerText()).trim(),
    "",
    "task body is a message, not a composer draft",
  );
  assert.ok(await preview.getByTestId("work-task-pending-send").isDisabled());
  const model = preview.getByTestId("work-task-pending-model");
  assert.ok(await model.isDisabled());
  assert.equal(await model.getAttribute("data-model-current-value"), modelValue);
  assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 0);
  assert.equal(await preview.locator('[data-v4-composer-dock="true"]').count(), 1);
  assert.equal(await preview.locator('[data-v4-timeline-scroll="true"]').count(), 1);
}

export async function exerciseWorkTaskHomeRepositoryError(page, panel, card, artifacts) {
  await page.setViewportSize({ width: 1280, height: 850 });
  const message =
    "当前任务的项目仓库指向用户目录，无法安全创建工作树。请打开正确的项目仓库，并在该项目下新建任务。";
  for (const kind of ["api", "acp"]) {
    const task = await page.evaluate((kind) => {
      const sample = window.__tasks.tasks.find((task) => task.execution.kind === kind);
      return window.__tasks.seed({
        title: `Home repository ${kind} task`,
        prompt: "Keep the original task text",
        runText: "Keep the original task text",
        execution: structuredClone(sample.execution),
        status: "failed",
        runSeq: 1,
        failureReason: "work-task.home-repository",
        worktree: {
          rootPath: "/synthetic/trees",
          path: "/synthetic/trees/stale/home",
          projectPath: "/synthetic/home",
          branchName: "worktree/stale",
          baseCommit: "abcdef",
        },
      });
    }, kind);
    await card(task.id).waitFor();
    const before = await page.evaluate(() => window.__tasks.calls.filter((c) => c.op !== "list"));
    await card(task.id).getByRole("button", { name: task.title, exact: true }).click();
    const preview = panel.getByTestId("work-task-unstarted");
    await preview.getByRole("alert").waitFor();
    assert.equal(await preview.getByRole("alert").innerText(), message);
    await assertWorkTaskPendingChat(panel, {
      text: task.runText,
      modelValue: kind === "acp" ? "acp:codex" : "custom:api:TestModel",
    });
    await panel.getByRole("button", { name: "任务详情", exact: true }).click();
    const detail = page.getByTestId("work-task-detail");
    await detail.waitFor();
    assert.equal(await detail.getByRole("alert").innerText(), message);
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });
    assert.deepEqual(
      await page.evaluate(() => window.__tasks.calls.filter((c) => c.op !== "list")),
      before,
      "viewing a rejected home-repository task must not retry, connect or prompt",
    );
    assert.equal(
      await page.evaluate(
        (id) => window.__tasks.tasks.find((task) => task.id === id).worktree.projectPath,
        task.id,
      ),
      task.worktree.projectPath,
      "viewing the error must not rewrite a stale allocation",
    );
    await page.screenshot({ path: join(artifacts, `home-repository-${kind}.png`) });
  }
}

export async function exerciseWorkTaskPendingChatLayout(page, panel, artifacts) {
  const original = await page.evaluate(() => ({
    theme: document.documentElement.className,
    runText: window.__tasks.tasks[1].runText,
    error: window.__tasks.tasks[1].failureReason,
  }));
  const before = await page.evaluate(() => window.__tasks.calls.filter((c) => c.op !== "list"));
  const longText = "检查任务正文和很长的路径\n" + "long-project-path/".repeat(40);
  await page.evaluate((text) => {
    window.__tasks.tasks[1].runText = text;
    window.__tasks.tasks[1].failureReason =
      "Synthetic git failure: " + "long-error-path/".repeat(35);
    window.__tasks.status("task-1", "failed");
  }, longText);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await assertWorkTaskPendingChat(panel, { text: longText, modelValue: "acp:codex" });
      const preview = panel.getByTestId("work-task-unstarted");
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      assert.ok(
        await preview.evaluate((element) =>
          [element, ...element.querySelectorAll("[data-v4-timeline-scroll], form")].every(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ),
        `${theme}/${width}: chat surfaces must not overflow horizontally`,
      );
      const input = await preview.getByTestId("work-task-pending-input").boundingBox();
      const send = await preview.getByTestId("work-task-pending-send").boundingBox();
      const viewport = await preview.boundingBox();
      assert.ok(input.y > viewport.y && input.y + input.height <= viewport.y + viewport.height);
      assert.ok(send.y > input.y && send.y + send.height <= viewport.y + viewport.height);
      assert.ok(
        viewport.y + viewport.height - send.y - send.height < 40,
        "composer stays at bottom",
      );
      await preview.getByTestId("work-task-pending-input").click();
      await page.keyboard.type("Must not become a draft");
      await page.keyboard.press("Enter");
      await preview
        .locator("form")
        .evaluate((form) =>
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      assert.equal((await preview.getByTestId("work-task-pending-input").innerText()).trim(), "");
      assert.equal(await page.getByRole("menu").count(), 0);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-pending-chat.png`) });
    }
  }
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((c) => c.op !== "list")),
    before,
    "preview interactions must not create, authenticate, configure, prompt or upload",
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate((original) => {
    document.documentElement.className = original.theme;
    window.__tasks.tasks[1].runText = original.runText;
    window.__tasks.tasks[1].failureReason = original.error;
    window.__tasks.status("task-1", "failed");
  }, original);
}
