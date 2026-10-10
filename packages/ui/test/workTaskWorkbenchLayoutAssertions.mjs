import assert from "node:assert/strict";

export async function remountWorkTaskPanel(page, panel) {
  const previous = await panel.elementHandle();
  await page.evaluate(() => window.__tasks.remount());
  // 相同尺寸不能证明新页面已挂载，必须先等旧节点退出，避免读取已移除节点的空样式。
  await page.waitForFunction((element) => !element.isConnected, previous);
  await previous.dispose();
  await panel.getByTestId("work-task-board").waitFor();
}

export async function exerciseWorkTaskWorkbenchLayout(page, panel) {
  const shell = panel.getByTestId("work-task-workbench");
  await shell.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="work-task-workbench"]')?.dataset.wide === "true",
  );
  const sidebar = panel.getByTestId("work-task-sidebar");
  const conversation = panel.getByTestId("work-task-conversation");
  const before = await sidebar.boundingBox();
  const right = await conversation.boundingBox();
  assert.ok(Math.abs(before.width - 360) < 2, "task sidebar must allow more title space");
  assert.ok(right.width > 800 && right.x >= before.x + before.width);
  const handle = shell.getByRole("separator", { name: "调整任务栏宽度", exact: true });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (width) =>
      document.getElementById("work-task-sidebar").getBoundingClientRect().width > width + 20,
    before.width,
  );
  const dragged = await sidebar.boundingBox();
  await handle.focus();
  await handle.press("ArrowLeft");
  await page.waitForFunction(
    (width) =>
      document.getElementById("work-task-sidebar").getBoundingClientRect().width < width - 5,
    dragged.width,
  );
  const width = (await sidebar.boundingBox()).width;
  const rightWidth = (await conversation.boundingBox()).width;
  const percent = (width / (width + rightWidth)) * 100;
  await page.waitForFunction(
    (expected) =>
      Object.entries(localStorage).some(
        ([key, value]) =>
          key.startsWith("react-resizable-panels:work-tasks-workbench-horizontal-v1:") &&
          Math.abs(JSON.parse(value)["work-task-sidebar"] - expected) < 0.2,
      ),
    percent,
  );
  await remountWorkTaskPanel(page, panel);
  await page.waitForFunction(
    (expected) =>
      Math.abs(
        document.getElementById("work-task-sidebar").getBoundingClientRect().width - expected,
      ) < 1,
    width,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list")),
    [],
  );
}

export async function assertWorkTaskSessionTarget(panel, kind, id, path) {
  const session = panel.getByTestId("work-task-fixture-session");
  // 旧会话仍在场时不能仅等待节点存在，要等新选择的绑定实际完成投影。
  await panel
    .locator(
      `[data-testid="work-task-fixture-session"][data-kind="${kind}"][data-session="${id}"][data-workspace="${path}"]`,
    )
    .waitFor();
  assert.equal(await session.getAttribute("data-kind"), kind);
  assert.equal(await session.getAttribute("data-session"), id);
  assert.equal(await session.getAttribute("data-workspace"), path);
  assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 1);
  const header = panel.getByTestId("work-task-content").locator(":scope > header");
  assert.equal(
    await header.getByRole("button", { name: "在主窗口打开会话", exact: true }).count(),
    0,
    "API and ACP task headers must not expose the main-view jump button",
  );
  for (const name of ["任务详情", "任务操作", "关闭任务查看"])
    assert.ok(await header.getByRole("button", { name, exact: true }).isVisible());
  for (const name of ["在 Finder 中打开", "选择打开方式"])
    assert.ok(await header.getByRole("button", { name, exact: true }).isVisible());
  assert.equal(await header.getByTestId("workspace-help-menu-trigger").count(), 0);
  assert.ok(await header.getByTestId("terminal-toggle").isVisible());
  // 展开侧栏后原顶部开关会隐藏，关闭入口由侧栏标题持有。
  if (await header.getByTestId("side-pane-toggle").count())
    assert.ok(await header.getByTestId("side-pane-toggle").isVisible());
  else assert.ok(await panel.page().getByTestId("work-task-review-fixture").isVisible());
}

export async function exerciseWorkTaskConversationResize(page, panel) {
  const draft = panel.getByRole("textbox", { name: "Synthetic conversation draft", exact: true });
  await draft.fill("保留任务草稿");
  const session = await panel.getByTestId("work-task-fixture-session").elementHandle();
  for (const maximize of [false, true]) {
    if (maximize) {
      const handle = panel.getByRole("separator", { name: "调整任务栏宽度", exact: true });
      const grip = await handle.boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + 600, grip.y + grip.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(
        () => document.getElementById("work-task-sidebar").clientWidth === 560,
      );
    }
    const sidebar = await panel.getByTestId("work-task-sidebar").boundingBox();
    const right = await panel.getByTestId("work-task-conversation").boundingBox();
    const percentage = (sidebar.width / (sidebar.width + right.width)) * 100;
    await page.waitForFunction(
      (expected) =>
        Object.entries(localStorage).some(
          ([key, value]) =>
            key.startsWith("react-resizable-panels:work-tasks-workbench-horizontal-v1:") &&
            Math.abs(JSON.parse(value)["work-task-sidebar"] - expected) < 0.2,
        ),
      percentage,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await panel.getByTestId("work-task-sidebar").waitFor({ state: "hidden" });
      await assertWorkTaskSessionTarget(
        panel,
        "acp",
        "session-task-1",
        "/synthetic/trees/task-1/project",
      );
      assert.ok(
        Math.abs((await panel.getByTestId("work-task-conversation").boundingBox()).width - width) <
          1,
      );
      assert.equal(await draft.inputValue(), "保留任务草稿");
      assert.equal(
        await page.evaluate(
          (element) =>
            element === document.querySelector('[data-testid="work-task-fixture-session"]'),
          session,
        ),
        true,
      );
      await page.setViewportSize({ width: 1280, height: 850 });
      await panel.getByTestId("work-task-sidebar").waitFor();
      await page.waitForFunction(
        (expected) =>
          Math.abs(
            document.getElementById("work-task-sidebar").getBoundingClientRect().width - expected,
          ) < 1,
        sidebar.width,
      );
      assert.equal(await draft.inputValue(), "保留任务草稿");
    }
  }
  await session.dispose();
}
