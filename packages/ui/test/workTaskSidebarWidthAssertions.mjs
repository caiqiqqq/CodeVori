import assert from "node:assert/strict";
import { join } from "node:path";
import {
  exerciseWorkTaskWorkbenchLayout,
  exerciseWorkTaskConversationResize,
  remountWorkTaskPanel,
} from "./workTaskWorkbenchLayoutAssertions.mjs";
import { assertWorkTaskBoardLayout } from "./workTaskBoardLayoutAssertions.mjs";

export async function exerciseWorkTaskSidebarWidth(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(() => {
    window.__tasks.seed({
      id: "task-1",
      title: "任务标题加宽后显示更多内容，状态和操作菜单仍然保持可用",
      prompt: "ACP",
      status: "running",
      execution: { kind: "acp", agent: "codex", config: [] },
      session: { kind: "acp", id: "session-task-1" },
      worktree: { path: "/synthetic/trees/task-1/project" },
    });
  });
  await panel.getByTestId("work-task-project").click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  const card = panel.locator('[data-task-id="task-1"]');
  await card.click();
  await panel.getByTestId("work-task-fixture-session").waitFor();
  await exerciseWorkTaskWorkbenchLayout(page, panel);
  await exerciseWorkTaskConversationResize(page, panel);
  const handle = panel.getByRole("separator", { name: "调整任务栏宽度", exact: true });
  const sidebar = panel.getByTestId("work-task-sidebar");
  const conversation = panel.getByTestId("work-task-conversation");
  const setWidth = async (width) => {
    await page.mouse.move(0, 0);
    const box = await handle.boundingBox();
    const current = await sidebar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + width - current.width, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
  };
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    await setWidth(320);
    const oldTitleWidth = await card
      .getByTestId("work-task-card-title")
      .evaluate((e) => e.clientWidth);
    const save = (expected) =>
      page.waitForFunction(
        (expected) =>
          Object.entries(localStorage).some(
            ([key, value]) =>
              key.startsWith("react-resizable-panels:work-tasks-workbench-horizontal-v1:") &&
              Math.abs(JSON.parse(value)["work-task-sidebar"] - expected) < 0.2,
          ),
        expected,
      );
    const percent = async () => {
      const left = await sidebar.boundingBox();
      const right = await conversation.boundingBox();
      return (left.width / (left.width + right.width)) * 100;
    };
    await save(await percent());
    await remountWorkTaskPanel(page, panel);
    assert.ok(Math.abs((await sidebar.boundingBox()).width - 320) < 2, "keep old manual width");
    await setWidth(360);
    assert.ok(Math.abs((await sidebar.boundingBox()).width - 360) < 2);
    assert.ok(
      (await card.getByTestId("work-task-card-title").evaluate((e) => e.clientWidth)) >=
        oldTitleWidth + 38,
      "extra width must reach the title",
    );
    await assertWorkTaskBoardLayout(panel);
    await page.screenshot({ path: join(artifacts, `${theme}-360-sidebar.png`) });
    await setWidth(650);
    assert.ok(Math.abs((await sidebar.boundingBox()).width - 560) < 2, "enforce new upper bound");
    await save(await percent());
    await remountWorkTaskPanel(page, panel);
    assert.ok(Math.abs((await sidebar.boundingBox()).width - 560) < 2);
    await page.setViewportSize({ width: 768, height: 850 });
    await page.waitForFunction(
      () =>
        document.getElementById("work-task-workbench").clientWidth === 768 &&
        document.getElementById("work-task-sidebar").getBoundingClientRect().width <= 385,
    );
    assert.ok((await conversation.boundingBox()).width >= 379, "keep conversation space");
    await assertWorkTaskBoardLayout(panel);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.waitForFunction(
      () => document.getElementById("work-task-workbench").clientWidth === 1280,
    );
  }
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list")),
    [],
    "layout must not issue business commands",
  );
  process.stdout.write(
    "PASS: wider default, drag limits, title space, saved widths and responsive conversation\n",
  );
}
