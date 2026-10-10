import assert from "node:assert/strict";
import { join } from "node:path";
import {
  assertWorkTaskSessionTarget,
  remountWorkTaskPanel,
} from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskArchiveWorktree(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const dialog = page.getByTestId("work-task-archive-worktree-dialog");
  const card = (id) => panel.locator(`[data-testid="work-task-card"][data-task-id="${id}"]`);
  const openMenu = async (id, locale = "zh-CN") => {
    await card(id)
      .getByRole("button", { name: locale === "zh-CN" ? "任务操作" : "Task actions", exact: true })
      .click();
    return page.locator('[role="menu"][data-state="open"]');
  };
  const openCleanup = async (id, locale = "zh-CN", retry = false) => {
    const menu = await openMenu(id, locale);
    await menu
      .getByRole("menuitem", {
        name: retry
          ? locale === "zh-CN"
            ? "重试清理"
            : "Retry cleanup"
          : locale === "zh-CN"
            ? "归档并删除工作树"
            : "Archive and delete worktree",
        exact: true,
      })
      .click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    await dialog.waitFor();
  };
  for (const kind of ["api", "acp"]) {
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 850 });
    await panel.getByTestId("work-task-board").waitFor();
    const task = await page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Cleanup ${kind}`,
          prompt: "Completed task",
          status: "done",
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          session: { kind, id: `cleanup-${kind}` },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/cleanup-${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/cleanup-${kind}`,
            baseCommit: "abcdef",
          },
        }),
      kind,
    );
    const count = () =>
      page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "archive").length);
    const ordinary = await page.evaluate(() =>
      window.__tasks.seed({
        title: "Ordinary done",
        prompt: "Done",
        status: "done",
        useWorktree: false,
      }),
    );
    let menu = await openMenu(ordinary.id);
    assert.equal(
      await menu.getByRole("menuitem", { name: "归档并删除工作树", exact: true }).count(),
      0,
    );
    await menu.getByRole("menuitem", { name: "归档", exact: true }).click();
    await card(ordinary.id).waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.findLast((call) => call.op === "archive").removeWorktree,
      ),
      undefined,
    );
    await page.evaluate((id) => window.__tasks.status(id, "review"), task.id);
    menu = await openMenu(task.id);
    assert.equal(
      await menu.getByRole("menuitem", { name: "归档并删除工作树", exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.evaluate((id) => window.__tasks.status(id, "done"), task.id);
    await card(task.id).getByRole("button", { name: task.title, exact: true }).click();
    await assertWorkTaskSessionTarget(panel, kind, task.session.id, task.worktree.path);
    const before = await count();
    await openCleanup(task.id);
    assert.ok((await dialog.innerText()).includes(task.worktree.path));
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await count(), before);
    await page.evaluate(() => {
      window.__tasks.failCleanup = true;
    });
    await openCleanup(task.id);
    await dialog.getByRole("button", { name: "归档并删除工作树", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await card(task.id).locator('[data-worktree-cleanup="failed"]').waitFor();
    assert.match(
      await card(task.id).locator('[data-worktree-cleanup="failed"]').getAttribute("title"),
      /未提交改动/,
    );
    await openCleanup(task.id, "zh-CN", true);
    await dialog.getByRole("alert").waitFor();
    assert.match(await dialog.getByRole("alert").innerText(), /未提交改动/);
    assert.equal(await card(task.id).getAttribute("data-selected"), "true");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    for (const locale of ["zh-CN", "en-US"]) {
      await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.className =
            theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
        }, theme);
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 850 });
          await page.waitForFunction(
            (width) =>
              document.getElementById("work-task-workbench")?.getAttribute("data-wide") ===
              String(width >= 768),
            width,
          );
          if (width === 320) {
            const back = panel.getByRole("button", {
              name: locale === "zh-CN" ? "返回待办" : "Back to tasks",
              exact: true,
            });
            if (await back.isVisible()) await back.click();
          }
          await openCleanup(task.id, locale, true);
          assert.ok(
            await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          );
          await page.screenshot({
            path: join(artifacts, `archive-worktree-${kind}-${locale}-${theme}-${width}.png`),
            animations: "disabled",
          });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
    await card(task.id).getByRole("button", { name: task.title, exact: true }).click();
    await openCleanup(task.id, "zh-CN", true);
    await page.evaluate(() => {
      window.__tasks.delayCleanup = true;
    });
    const confirm = dialog.getByRole("button", { name: "归档并删除工作树", exact: true });
    const callsBefore = await count();
    await confirm.click();
    await page.waitForFunction(() => window.__tasks.pendingCleanups.length === 1);
    await dialog.waitFor({ state: "detached" });
    await card(task.id).locator('[data-worktree-cleanup="running"]').waitFor();
    assert.match(await card(task.id).innerText(), /清理中/);
    assert.equal(await card(task.id).getAttribute("data-selected"), "true");
    await openMenu(task.id);
    const runningMenu = page.locator('[role="menu"][data-state="open"]');
    assert.equal(
      await runningMenu
        .getByRole("menuitem", { name: "归档", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    assert.equal(
      await runningMenu
        .getByRole("menuitem", { name: "归档并删除工作树", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    // 面板重挂载模拟重连，从 Host 列表恢复正在清理的事实，不重新提交。
    await remountWorkTaskPanel(page, panel);
    await card(task.id).locator('[data-worktree-cleanup="running"]').waitFor();
    assert.equal(await count(), callsBefore + 1);
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        if (width === 320) {
          const back = panel.getByRole("button", { name: "返回待办", exact: true });
          if (await back.isVisible()) await back.click();
        }
        await card(task.id).locator('[data-worktree-cleanup="running"]').waitFor();
        assert.equal(
          await card(task.id).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          true,
        );
        await page.screenshot({
          path: join(artifacts, `cleanup-running-${kind}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__tasks.finishCleanup());
    await dialog.waitFor({ state: "detached" });
    await card(task.id).waitFor({ state: "detached" });
    await panel.getByTestId("work-task-no-selection").waitFor();
    assert.equal(await count(), callsBefore + 1);
    assert.deepEqual(
      await page.evaluate(() => window.__tasks.calls.findLast((call) => call.op === "archive")),
      {
        op: "archive",
        workspacePath: "/synthetic/project",
        id: task.id,
        archived: true,
        removeWorktree: true,
      },
    );
  }
  process.stdout.write(
    "PASS: API/ACP cleanup menu, ordinary archive boundary, cancel, failure/retry, busy exclusion, selection clearing, scoped command, bilingual responsive themes.\n",
  );
}
