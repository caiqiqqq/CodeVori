import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskWorkspaceMode(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  for (const enabled of [true, false]) {
    await panel.getByTestId("work-task-new").click();
    assert.equal(await editor.getByTestId("work-task-title").count(), 0);
    const toggle = editor.getByRole("switch", { name: "使用工作树", exact: true });
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await editor
      .getByTestId("work-task-prompt")
      .fill(`Mode ${enabled}\nModify the selected branch`);
    await editor.getByTestId("work-task-source-branch").click();
    await page.getByRole("option", { name: "release", exact: true }).click();
    if (!enabled) {
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-checked"), "false");
      await editor.getByTestId("work-task-source-branch").click();
      assert.equal(await page.getByRole("option", { name: "当前 HEAD", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
    }
    for (const theme of ["theme-zai-light", "theme-zai-dark dark"]) {
      await page.evaluate((value) => {
        document.documentElement.className = value;
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        assert.equal(
          await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
        );
        await editor.screenshot({
          path: join(artifacts, `workspace-${enabled}-${theme.split(" ")[0]}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
    const task = await page.evaluate(() => window.__tasks.tasks.at(-1));
    assert.equal(task.useWorktree, enabled);
    assert.equal(task.sourceBranch, "release");
    assert.equal(task.title, `Mode ${enabled} Modify the selected branch`);
    assert.equal(task.status, "todo");
    assert.equal(task.worktree, undefined);
    assert.equal(task.directBranch, undefined);
    assert.equal(
      await page.evaluate(() => window.__tasks.currentBranch),
      "main",
      "save must not switch branches",
    );
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "start").length),
      0,
    );
    const card = panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
    await card.getByRole("button", { name: "任务操作", exact: true }).click();
    await page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "编辑任务", exact: true })
      .click();
    assert.equal(
      await editor
        .getByRole("switch", { name: "使用工作树", exact: true })
        .getAttribute("aria-checked"),
      String(enabled),
    );
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    if (!enabled) {
      await page.evaluate((id) => {
        const task = window.__tasks.tasks.find((task) => task.id === id);
        task.directBranch = task.sourceBranch;
        task.session = { kind: task.execution.kind, id: "direct-session" };
        task.status = "failed";
        task.runSeq = 1;
        window.__tasks.changed();
      }, task.id);
      await card.getByRole("button", { name: task.title, exact: true }).click();
      await assertWorkTaskSessionTarget(panel, "api", "direct-session", "/synthetic/project");
      await card.getByRole("button", { name: "任务操作", exact: true }).click();
      await page
        .locator('[role="menu"][data-state="open"]')
        .getByRole("menuitem", { name: "编辑任务", exact: true })
        .click();
      assert.equal(
        await editor.getByRole("switch", { name: "使用工作树", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await editor.getByTestId("work-task-source-branch").isDisabled(), true);
      await editor.getByRole("button", { name: "取消", exact: true }).click();
    }
  }
}
