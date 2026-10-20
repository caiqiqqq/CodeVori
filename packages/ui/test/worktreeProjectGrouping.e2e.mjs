// Run against ZCode Dev after opening a main repository and its linked worktree:
// ZCODE_E2E_MAIN_PATH=/path/to/main ZCODE_E2E_WORKTREE_PATH=/path/to/worktree node packages/ui/test/worktreeProjectGrouping.e2e.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const mainPath = process.env.ZCODE_E2E_MAIN_PATH;
const worktreePath = process.env.ZCODE_E2E_WORKTREE_PATH;
assert.ok(mainPath && worktreePath, "Provide the opened main and linked worktree paths");
const browser = await chromium.connectOverCDP(
  process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229",
);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes(":5174/"));
  assert.ok(page, "ZCode Dev renderer must be running on port 5174");
  const projectList = page.getByTestId("workspace-list");
  const main = projectList.locator(`[data-testid="workspace-item-${mainPath}"]`);
  const conversations = projectList.locator(`[data-project-workspace-path="${mainPath}"]`);
  const marker = conversations.locator(`[data-worktree-path="${worktreePath}"]`).first();
  await main.waitFor();
  if ((await main.getAttribute("aria-expanded")) !== "true") await main.click();
  await marker.waitFor();
  assert.equal(
    await projectList.getByTestId(`workspace-item-${worktreePath}`).count(),
    0,
    "Worktree conversations must not add a child project or expansion control",
  );
  assert.equal(
    (await conversations.getByTestId("worktree-conversation-indicator").count()) > 0,
    true,
  );
  const flatRows = conversations.locator('[data-testid^="task-item-"], [data-acp-session-id]');
  assert.ok((await flatRows.count()) > 0);
  assert.equal(await conversations.locator('[data-testid^="workspace-item-"]').count(), 0);

  // 父项目与子工作树必须共享同一高度动画；子行不能在动画开始时先瞬间消失。
  const collapse = await projectList.evaluate(
    async (list, paths) => {
      const mainItem = list.querySelector(`[data-testid="workspace-item-${paths.mainPath}"]`);
      const mainRow = mainItem?.closest("li");
      const content = mainRow?.querySelector('[data-slot="collapsible-content"]');
      const worktreeItem = mainRow?.querySelector(`[data-worktree-path="${paths.worktreePath}"]`);
      if (!(mainItem instanceof HTMLElement) || !content || !worktreeItem) {
        throw new Error("Main project, animation content or linked worktree is missing");
      }
      const nestedInAnimatedContent = content.contains(worktreeItem);
      const initialHeight = content.getBoundingClientRect().height;
      mainItem.click();
      await new Promise((resolve) => setTimeout(resolve, 110));
      return {
        nestedInAnimatedContent,
        initialHeight,
        middleHeight: content.getBoundingClientRect().height,
        worktreePresentMidAnimation: worktreeItem.isConnected && content.contains(worktreeItem),
      };
    },
    { mainPath, worktreePath },
  );
  assert.equal(collapse.nestedInAnimatedContent, true);
  assert.equal(collapse.worktreePresentMidAnimation, true);
  assert.ok(
    collapse.middleHeight > 0 && collapse.middleHeight < collapse.initialHeight,
    `Project height should shrink smoothly: ${collapse.initialHeight} -> ${collapse.middleHeight}`,
  );
  assert.equal(
    await projectList.evaluate(
      (list, paths) => {
        const child = list.querySelector(`[data-worktree-path="${paths.worktreePath}"]`);
        const parentContent = child?.closest('[data-slot="collapsible-content"]');
        return Boolean(
          child?.isConnected && parentContent?.getAttribute("data-state") === "closed",
        );
      },
      { mainPath, worktreePath },
    ),
    true,
    "Collapsing the project hides flat conversations without unmounting their rows",
  );
  await main.click();
  await marker.waitFor();
  const worktreeRow = marker.locator("xpath=ancestor::li[1]");
  const ordinaryRow = flatRows
    .filter({ hasNot: page.getByTestId("worktree-conversation-indicator") })
    .first();
  if (await ordinaryRow.count()) {
    const worktreeLeft = (await worktreeRow.boundingBox()).x;
    const ordinaryLeft = (await ordinaryRow.boundingBox()).x;
    assert.ok(
      Math.abs(worktreeLeft - ordinaryLeft) < 1,
      "Conversation rows share the same indentation",
    );
  }
  await marker.hover();
  await page
    .getByRole("tooltip")
    .filter({ hasText: /工作树对话|Worktree conversation/ })
    .waitFor();
  process.stdout.write(
    "PASS: Worktree conversations are flat under their main project, keep a path tooltip and share the project animation.\n",
  );
} finally {
  await browser.close();
}
