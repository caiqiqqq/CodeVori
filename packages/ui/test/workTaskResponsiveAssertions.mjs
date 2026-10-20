import assert from "node:assert/strict";
import { join } from "node:path";
import { assertWorkTaskBoardLayout } from "./workTaskBoardLayoutAssertions.mjs";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";
import { assertWorkTaskCompactToolbar } from "./workTaskSelectionAssertions.mjs";

export async function exerciseWorkTaskResponsiveLayout(page, panel, artifacts) {
  const editor = page.getByTestId("work-task-editor");
  const detail = page.getByTestId("work-task-detail");
  const card = panel.locator('[data-testid="work-task-card"][data-task-id="task-1"]');
  const returnToBoard = async () => {
    const close = panel.getByRole("button", { name: "关闭任务查看", exact: true });
    if (await close.count()) await close.click();
    await panel.getByTestId("work-task-board").waitFor();
  };
  const settle = async () => {
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
  };
  const noOverflow = async (label) => {
    await settle();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      label + " document overflow",
    );
    assert.ok(
      await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '[data-testid="work-tasks-panel"], [data-testid="work-task-editor"], [data-testid="work-task-detail"]',
          ),
        ).every((element) => element.scrollWidth <= element.clientWidth + 1),
      ),
      label + " panel overflow",
    );
    assert.ok(
      await page.evaluate(() =>
        Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
      ),
      label + " missing icon asset",
    );
  };
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await returnToBoard();
      await assertWorkTaskBoardLayout(panel);
      await assertWorkTaskCompactToolbar(panel);
      await noOverflow(`${theme}/${width}/board`);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-board.png`) });
      await card.getByRole("button", { name: "Implement an ACP task", exact: true }).click();
      await assertWorkTaskSessionTarget(
        panel,
        "acp",
        "session-task-1",
        "/synthetic/trees/task-1/project",
      );
      await noOverflow(`${theme}/${width}/conversation`);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-conversation.png`) });
      if (width < 768)
        assert.equal(await panel.getByTestId("work-task-sidebar").isVisible(), false);
      await panel.getByRole("button", { name: "任务详情", exact: true }).click();
      await noOverflow(`${theme}/${width}/detail`);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-detail.png`) });
      await detail.getByRole("button", { name: "Close", exact: true }).click();
      await detail.waitFor({ state: "detached" });
      if (width < 768) await panel.getByRole("button", { name: "返回待办", exact: true }).click();
      await panel.getByTestId("work-task-new").click();
      await editor.waitFor();
      await editor.getByTestId("work-task-model").click();
      await page.getByTestId("chat-model-select-item-acp:codex").click();
      assert.ok(
        await editor
          .getByTestId("work-task-model")
          .getByText("Codex ACP", { exact: true })
          .isVisible(),
      );
      await noOverflow(`${theme}/${width}/editor`);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-editor.png`) });
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      await editor.waitFor({ state: "detached" });
    }
  }
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 560 });
    await returnToBoard();
    await assertWorkTaskBoardLayout(panel);
    await assertWorkTaskCompactToolbar(panel);
    await noOverflow(`short/${width}/board`);
    assert.ok(
      await panel
        .getByTestId("work-task-board-scroll")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
      "short windows must scroll the board instead of shrinking section headers",
    );
    const project = await panel.getByTestId("work-task-project").boundingBox();
    assert.ok(project.y >= 0 && project.y + project.height <= 560);
    const actions = await panel.getByTestId("work-task-actions").boundingBox();
    assert.ok(actions.y >= 0 && actions.y + actions.height <= 560);
    await page.screenshot({ path: join(artifacts, `short-${width}-board.png`) });
  }
}

export async function captureWorkTaskLayoutFailure(browser, artifacts) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (!page) return;
  process.stderr.write(
    JSON.stringify(
      await page.evaluate(() => ({
        bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
        active: {
          tag: document.activeElement?.tagName,
          label: document.activeElement?.getAttribute("aria-label"),
        },
        overlays: document.querySelectorAll('[role="dialog"], [role="menu"]').length,
        sidebar: document.getElementById("work-task-sidebar")?.getBoundingClientRect(),
        project: document
          .querySelector('[data-testid="work-task-project"]')
          ?.getBoundingClientRect(),
        columns: Array.from(
          document.querySelectorAll('[data-testid="work-task-column-content"]'),
        ).map((element) => ({
          column: element.closest("[data-work-task-column]").dataset.workTaskColumn,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollTop: element.scrollTop,
          height: element.clientHeight,
        })),
      })),
    ) + "\n",
  );
  await page.screenshot({ path: join(artifacts, "failure.png") });
  process.stderr.write(`Failure screenshot: ${artifacts}/failure.png\n`);
}
