import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskBoardLayout } from "./workTaskBoardLayoutAssertions.mjs";

export async function exerciseWorkTaskEqualWidths(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(() => {
    for (const [index, status] of ["todo", "running", "awaiting_input", "done"].entries())
      window.__tasks.seed({
        id: `equal-width-${index}`,
        title: `任务 ${index}`,
        prompt: "正文",
        status,
      });
  });
  const row = panel.locator('[data-task-id="equal-width-3"]');
  await row.waitFor();
  await panel.getByRole("separator", { name: "调整任务栏宽度", exact: true }).press("ArrowLeft");
  await page.waitForFunction(
    () => document.getElementById("work-task-sidebar").clientWidth === 260,
  );
  const commands = () =>
    page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list"));
  const before = await commands();
  const doneContent = panel
    .locator('[data-work-task-column="done"]')
    .getByTestId("work-task-column-content");
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForFunction(() => {
        const group = document.getElementById("work-task-workbench");
        const sidebar = document.getElementById("work-task-sidebar");
        const wide = group.clientWidth >= 768;
        return (
          group.dataset.wide === String(wide) &&
          (wide || Math.abs(sidebar.clientWidth - group.clientWidth) <= 1)
        );
      });
      assert.ok(
        await doneContent.evaluate((element) => element.scrollHeight <= element.clientHeight),
      );
      const initial = await row.boundingBox();
      await page.evaluate(() => {
        for (let index = 0; index < 24; index++)
          window.__tasks.seed({
            id: `width-overflow-${index}`,
            title: "已完成任务",
            prompt: "正文",
            status: "done",
          });
      });
      await panel.locator('[data-task-id="width-overflow-23"]').waitFor();
      assert.ok(
        await doneContent.evaluate((element) => element.scrollHeight > element.clientHeight),
      );
      await assertWorkTaskBoardLayout(panel);
      assert.ok(
        Math.abs((await row.boundingBox()).width - initial.width) < 1,
        "scrollbar appearance must not change task width",
      );
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-equal-width-tasks.png`) });
      await page.evaluate(() => {
        window.__tasks.tasks = window.__tasks.tasks.filter(
          (task) => !task.id.startsWith("width-overflow-"),
        );
        window.__tasks.notify();
      });
      await panel.locator('[data-task-id="width-overflow-23"]').waitFor({ state: "detached" });
      assert.ok(
        await doneContent.evaluate((element) => element.scrollHeight <= element.clientHeight),
      );
      await assertWorkTaskBoardLayout(panel);
      assert.ok(
        Math.abs((await row.boundingBox()).width - initial.width) < 1,
        "scrollbar disappearance must not change task width",
      );
    }
  }
  assert.deepEqual(await commands(), before, "equal-width layout must not issue task commands");
}
