import assert from "node:assert/strict";
import { join } from "node:path";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskCleanupSync(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const dialog = page.getByTestId("work-task-archive-worktree-dialog");
  for (const kind of ["api", "acp"]) {
    await page.reload();
    await panel.getByTestId("work-task-board").waitFor();
    const task = await page.evaluate(
      (kind) =>
        window.__tasks.seed({
          title: `Sync cleanup ${kind}`,
          prompt: "Completed task",
          status: "done",
          execution:
            kind === "api"
              ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
              : { kind, agent: "codex", config: [] },
          worktree: {
            rootPath: "/synthetic/trees",
            path: `/synthetic/trees/sync-${kind}/project`,
            projectPath: "/synthetic/project",
            branchName: `worktree/sync-${kind}`,
            baseCommit: "base",
          },
        }),
      kind,
    );
    const card = panel.locator(`[data-task-id="${task.id}"]`);
    const sync = (state) =>
      page.evaluate(
        ({ id, state }) => {
          const task = window.__tasks.tasks.find((task) => task.id === id);
          task.forgeWriteback = {
            id: "00000000-0000-4000-8000-000000000001",
            runSeq: 0,
            closeIssue: true,
            commentState: state === "failed" ? "failed" : "done",
            closeState: "done",
            ...(state === "live" || state === "expired"
              ? {
                  owner: "00000000-0000-4000-8000-000000000002",
                  leaseUntil: Date.now() + (state === "expired" ? -1 : 300_000),
                }
              : {}),
          };
          window.__tasks.notify();
        },
        { id: task.id, state },
      );
    for (const locale of ["zh-CN", "en-US"]) {
      await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
      const label = locale === "zh-CN" ? "归档并删除工作树" : "Archive and delete worktree";
      const hint =
        locale === "zh-CN"
          ? "任务已完成，正在同步议题，请稍后重试清理。"
          : "The task is complete. Issue sync is in progress; retry cleanup after it finishes.";
      const openMenu = async () => {
        await card
          .getByRole("button", {
            name: locale === "zh-CN" ? "任务操作" : "Task actions",
            exact: true,
          })
          .click();
        return page.locator('[role="menu"][data-state="open"]');
      };
      for (const theme of ["zai-light", "zai-dark"]) {
        const actionLabel =
          theme === "zai-dark" ? (locale === "zh-CN" ? "重试清理" : "Retry cleanup") : label;
        await page.evaluate(
          ({ id, failed }) => {
            window.__tasks.tasks.find((task) => task.id === id).worktreeCleanup = failed
              ? {
                  id: "old-cleanup",
                  phase: "failed",
                  error: "work-task.worktree-remove-dirty-worktree",
                }
              : undefined;
            window.__tasks.notify();
          },
          { id: task.id, failed: theme === "zai-dark" },
        );
        await page.evaluate((theme) => {
          document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
        }, theme);
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 850 });
          await page.waitForFunction(
            (width) =>
              document.getElementById("work-task-workbench")?.getAttribute("data-wide") ===
              String(width >= 768),
            width,
          );
          await sync("live");
          await remountWorkTaskPanel(page, panel);
          let menu = await openMenu();
          const cleanup = menu.getByRole("menuitem").filter({ hasText: actionLabel });
          assert.equal(await cleanup.getAttribute("aria-disabled"), "true");
          await cleanup.getByText(hint, { exact: true }).waitFor();
          assert.equal(
            await menu
              .getByRole("menuitem", { name: locale === "zh-CN" ? "归档" : "Archive", exact: true })
              .getAttribute("aria-disabled"),
            null,
            "ordinary archive remains unchanged",
          );
          await cleanup.click({ force: true });
          assert.equal(await dialog.count(), 0, "disabled menu must not open confirmation");
          await sync("done");
          await cleanup.getByText(hint, { exact: true }).waitFor({ state: "detached" });
          await menu.getByRole("menuitem", { name: actionLabel, exact: true }).click();
          await dialog.waitFor();
          const confirm = dialog.getByRole("button", { name: label, exact: true });
          assert.equal(await confirm.isEnabled(), true);
          await sync("live");
          await page.waitForFunction(
            () =>
              document.querySelector(
                '[data-testid="work-task-archive-worktree-dialog"] button.bg-destructive',
              )?.disabled,
          );
          assert.equal(
            await confirm.isEnabled(),
            false,
            "already-open dialog follows Host sync fact",
          );
          await dialog.getByRole("status").getByText(hint, { exact: true }).waitFor();
          assert.equal(
            await dialog
              .getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true })
              .isEnabled(),
            true,
          );
          assert.equal(await card.locator('[data-work-task-status="done"]').count(), 1);
          assert.equal(
            await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            true,
          );
          await page.screenshot({
            path: join(artifacts, `cleanup-sync-${kind}-${locale}-${theme}-${width}.png`),
            animations: "disabled",
          });
          for (const state of ["failed", "expired", "done"]) {
            await sync(state);
            await page.waitForFunction(
              () =>
                !document.querySelector(
                  '[data-testid="work-task-archive-worktree-dialog"] button.bg-destructive',
                )?.disabled,
            );
            assert.equal(await confirm.isEnabled(), true);
            assert.equal(await dialog.getByRole("status").count(), 0);
          }
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
        }
      }
      // 旧列表尚未投影同步租约时，Host 仍以专用业务码拒绝；反馈只属于本弹窗。
      await page.evaluate((id) => {
        window.__tasks.tasks.find((task) => task.id === id).worktreeCleanup = undefined;
        window.__tasks.notify();
      }, task.id);
      await sync("done");
      await remountWorkTaskPanel(page, panel);
      const menu = await openMenu();
      await menu.getByRole("menuitem", { name: label, exact: true }).click();
      await page.evaluate(() => {
        window.__tasks.failCleanupAdmission = true;
        window.__tasks.cleanupAdmissionError = "work-task.forge-busy";
      });
      await dialog.getByRole("button", { name: label, exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.match(
        await dialog.getByRole("alert").innerText(),
        locale === "zh-CN" ? /议题正在同步/ : /Issue sync is in progress/,
      );
      assert.equal(await panel.getByTestId("work-task-board-scroll").getByRole("alert").count(), 0);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const reopened = await openMenu();
      await reopened.getByRole("menuitem", { name: label, exact: true }).click();
      assert.equal(await dialog.getByRole("alert").count(), 0);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.filter((call) => call.op === "archive").length,
      ),
      2,
      "only explicit race submissions issue commands; disabled sync controls never submit",
    );
  }
  process.stdout.write(
    "PASS: API/ACP completed-task cleanup sync exclusion, live dialog updates, released/expired leases, race errors and bilingual responsive themes.\n",
  );
}
