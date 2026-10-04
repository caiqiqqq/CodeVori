import assert from "node:assert/strict";
import { assertWorkTaskCompactToolbar } from "./workTaskSelectionAssertions.mjs";
export async function assertWorkTaskBoardOnly(panel) {
  await panel.getByTestId("work-task-board").waitFor();
  assert.equal(await panel.getByRole("tab").count(), 0, "board must not expose a view switch");
  assert.equal(await panel.getByTestId("work-task-list").count(), 0, "list view must be removed");
  assert.equal(await panel.locator("[data-work-task-column]").count(), 4);
  await assertWorkTaskCompactToolbar(panel);
  await assertWorkTaskBoardLayout(panel);
}
import { join } from "node:path";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function assertWorkTaskCompactRows(panel) {
  const rows = await panel.getByTestId("work-task-card").evaluateAll((elements) =>
    elements.map((row) => {
      const outer = row.getBoundingClientRect();
      const parts = [
        "[data-work-task-agent]",
        '[data-testid="work-task-card-title"]',
        "[data-work-task-status]",
        'button[aria-haspopup="menu"]',
      ].map((selector) => {
        const element = row.querySelector(selector);
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
      return {
        id: row.dataset.taskId,
        x: outer.x,
        y: outer.y,
        width: outer.width,
        height: outer.height,
        scrollWidth: row.scrollWidth,
        clientWidth: row.clientWidth,
        paragraphs: row.querySelectorAll("p").length,
        parts,
      };
    }),
  );
  for (const row of rows) {
    assert.ok(row.height >= 35 && row.height <= 37, `task must fit one compact row: ${row.id}`);
    assert.equal(row.paragraphs, 0, "descriptions and errors must not expand task rows");
    assert.ok(row.scrollWidth <= row.clientWidth + 1, `task row must not overflow: ${row.id}`);
    for (let index = 0; index < row.parts.length; index++) {
      const part = row.parts[index];
      assert.ok(
        part?.width > 0 && part.height > 0,
        `missing inline content: ${JSON.stringify(row)}`,
      );
      assert.ok(
        Math.abs(part.y + part.height / 2 - row.y - row.height / 2) < 2,
        `icon, title, status and menu must share one line: ${row.id}`,
      );
      assert.ok(part.x >= row.x && part.x + part.width <= row.x + row.width + 1);
      if (index > 0)
        assert.ok(
          part.x >= row.parts[index - 1].x + row.parts[index - 1].width - 1,
          `inline content must not overlap: ${row.id}`,
        );
    }
  }
}

export async function assertWorkTaskBoardLayout(panel) {
  const board = panel.getByTestId("work-task-board");
  const boxes = await panel.locator("[data-work-task-column]").evaluateAll((sections) =>
    sections.map((section) => {
      const { x, y, width, height } = section.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  assert.equal(boxes.length, 4);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.width > 0 && box.height >= 111, "section must remain usable");
    assert.ok(Math.abs(box.x - boxes[0].x) < 1, "sections must share the same left edge");
    assert.ok(Math.abs(box.width - boxes[0].width) < 1, "sections must remain full width");
    if (index > 0)
      assert.ok(
        box.y >= boxes[index - 1].y + boxes[index - 1].height - 1,
        "sections must stack vertically without overlap",
      );
  }
  assert.equal(await board.getByRole("separator").count(), 3);
  assert.equal(
    await board.getByRole("separator").locator("svg").count(),
    3,
    "each separator must display its drag grip",
  );
  assert.deepEqual(
    await board
      .getByRole("separator")
      .evaluateAll((handles) => handles.map((handle) => handle.getAttribute("aria-orientation"))),
    ["horizontal", "horizontal", "horizontal"],
  );
  const colors = await panel
    .getByTestId("work-task-column-marker")
    .evaluateAll((markers) => markers.map((marker) => getComputedStyle(marker).backgroundColor));
  assert.equal(new Set(colors).size, 4, "section markers must distinguish each status group");
  const contents = await panel.getByTestId("work-task-column-content").evaluateAll((elements) =>
    elements.map((content) => {
      const empty = content.querySelector('[data-testid="work-task-empty"]');
      const outer = content.getBoundingClientRect();
      const inner = empty?.getBoundingClientRect();
      return {
        column: content.closest("[data-work-task-column]").dataset.workTaskColumn,
        overflowY: getComputedStyle(content).overflowY,
        scrollWidth: content.scrollWidth,
        clientWidth: content.clientWidth,
        centerOffset: inner ? inner.y + inner.height / 2 - outer.y - outer.height / 2 : 0,
      };
    }),
  );
  for (const content of contents) {
    assert.ok(
      content.overflowY === "auto" &&
        content.scrollWidth <= content.clientWidth + 1 &&
        Math.abs(content.centerOffset) < 2,
      `content must scroll independently with centered empty states: ${JSON.stringify(content)}`,
    );
  }
  await assertWorkTaskCompactRows(panel);
}

export async function exerciseWorkTaskCompactRows(page, panel, artifacts) {
  const themeBefore = await page.evaluate(() => document.documentElement.className);
  const commands = () =>
    page.evaluate(() =>
      window.__tasks.calls.filter((call) => !["list", "acp-catalog"].includes(call.op)),
    );
  const before = await commands();
  try {
    await page.evaluate(() => {
      for (let index = 0; index < 24; index++)
        window.__tasks.seed({
          id: `compact-task-${index}`,
          title: `${index} LongTaskTitleWithoutSpaces`.repeat(12),
          prompt: "Long description must remain available in the conversation.\n".repeat(16),
          execution: window.__tasks.tasks[index % 2].execution,
          status:
            index === 20
              ? "queued"
              : index === 21
                ? "running"
                : index === 22
                  ? "awaiting_input"
                  : index === 23
                    ? "done"
                    : "todo",
        });
      window.__tasks.seed({
        id: "compact-task-failed",
        title: "失败任务的长标题".repeat(12),
        prompt: "完整任务正文".repeat(30),
        status: "failed",
        failureReason: "Long preparation error.\n".repeat(30),
      });
    });
    await panel.locator('[data-task-id="compact-task-0"]').waitFor();
    const close = panel.getByRole("button", { name: "关闭任务查看", exact: true });
    if (await close.count()) await close.click();
    await panel.getByRole("separator", { name: "调整任务栏宽度", exact: true }).press("ArrowLeft");
    await page.waitForFunction(
      () => document.getElementById("work-task-sidebar").clientWidth === 260,
    );
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 850 });
        await assertWorkTaskBoardLayout(panel);
        const row = panel.locator('[data-task-id="compact-task-0"]');
        const title = row.getByTestId("work-task-card-title");
        assert.ok(await title.evaluate((element) => element.scrollWidth > element.clientWidth));
        assert.equal(
          await row.getByRole("button").first().getAttribute("title"),
          await title.innerText(),
          "full title must remain available on hover",
        );
        await page.screenshot({ path: join(artifacts, `${theme}-${width}-compact-tasks.png`) });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await exerciseWorkTaskBoardScroll(panel);
    const agent = panel.locator('[data-task-id="task-1"] [data-work-task-agent]');
    await agent.hover();
    await page
      .getByRole("tooltip")
      .filter({ hasText: /^Codex ACP$/ })
      .waitFor();
    await agent.click();
    assert.equal(
      await panel.locator('[data-task-id="task-1"]').getAttribute("data-selected"),
      "true",
      "clicking the agent icon must select its task",
    );
    await page.mouse.move(0, 0);
    await page.getByRole("tooltip").waitFor({ state: "detached" });
    assert.deepEqual(await commands(), before, "compact presentation must not issue commands");
  } finally {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
      window.__tasks.tasks = window.__tasks.tasks.filter(
        (task) => !task.id.startsWith("compact-task-"),
      );
      window.__tasks.notify();
    }, themeBefore);
    await page.setViewportSize({ width: 1280, height: 850 });
    await panel.locator('[data-task-id="compact-task-0"]').waitFor({ state: "detached" });
  }
}

export async function exerciseWorkTaskBoardResize(page, panel) {
  const first = panel.locator('[data-work-task-column="todo"]');
  const handle = panel.getByTestId("work-task-board").getByRole("separator").first();
  const before = await first.boundingBox();
  const grip = await handle.boundingBox();
  const writesBefore = await page.evaluate(() =>
    window.__tasks.calls.filter((call) => call.op !== "list"),
  );
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 32, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (height) =>
      document.querySelector('[data-work-task-column="todo"]').getBoundingClientRect().height >
      height + 20,
    before.height,
  );
  const dragged = await first.boundingBox();
  await handle.focus();
  await handle.press("ArrowUp");
  await page.waitForFunction(
    (height) =>
      document.querySelector('[data-work-task-column="todo"]').getBoundingClientRect().height <
      height - 5,
    dragged.height,
  );
  const sizes = await panel
    .locator("[data-work-task-column]")
    .evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().height));
  const expected = (sizes[0] / sizes.reduce((sum, height) => sum + height, 0)) * 100;
  // 布局库自动添加命名空间，不能仅以调用方的 layoutId 匹配存储键。
  await page.waitForFunction(
    (percentage) =>
      Object.entries(localStorage).some(
        ([key, value]) =>
          key.startsWith("react-resizable-panels:work-tasks-board-vertical-v1:") &&
          Math.abs(JSON.parse(value).todo - percentage) < 0.2,
      ),
    expected,
  );
  await remountWorkTaskPanel(page, panel);
  await page.waitForFunction(
    (height) =>
      Math.abs(
        document.querySelector('[data-work-task-column="todo"]').getBoundingClientRect().height -
          height,
      ) < 1,
    sizes[0],
  );
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list")),
    writesBefore,
    "resizing and restoring layout must not write task state",
  );
  await assertWorkTaskBoardLayout(panel);
}

export async function exerciseWorkTaskBoardScroll(panel) {
  const first = panel.locator('[data-work-task-column="todo"]');
  const header = first.getByRole("heading", { level: 3 });
  const content = first.getByTestId("work-task-column-content");
  const before = await header.boundingBox();
  assert.ok(
    await content.evaluate((element) => element.scrollHeight > element.clientHeight),
    "multiple tasks must scroll within their section",
  );
  await first.getByTestId("work-task-card").last().scrollIntoViewIfNeeded();
  assert.ok(await content.evaluate((element) => element.scrollTop > 0));
  assert.equal((await header.boundingBox()).y, before.y, "scrolling tasks must keep header fixed");
}
