// Reuse saved API/ACP conversations in the running renderer; never sends a prompt.
// ZCODE_E2E_MAIN_PATH=/path/to/main ZCODE_E2E_WORKTREE_PATH=/path/to/worktree node packages/ui/test/worktreeConversationSelection.e2e.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const list = page.getByTestId("workspace-list");
  const main = list.getByTestId(`workspace-item-${mainPath}`);
  const pane = page.getByTestId("v4-session-pane-workspace-main");
  const input = pane.getByTestId("v4-composer-input");
  assert.equal(await input.textContent(), "", "Preserve any existing user input before this test");

  async function expand(row) {
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await page.waitForTimeout(380);
  }
  async function snapshot() {
    const state = await pane.evaluate((element) => ({
      session: element.getAttribute("data-session-id"),
      model: element
        .querySelector('[data-testid="chat-model-select-trigger"]')
        ?.getAttribute("data-model-current-value"),
      transcript: element.querySelector('[data-testid="v4-timeline"]')?.textContent,
      turns: element.querySelectorAll("[data-v4-turn-unit]").length,
      input: element.querySelector('[data-testid="v4-composer-input"]')?.textContent,
    }));
    // 断言实际对话内容保持一致，但失败输出不记录用户的对话正文。
    return {
      ...state,
      transcript: createHash("sha256")
        .update(state.transcript ?? "")
        .digest("hex"),
    };
  }
  async function assertFoldPreservesConversation(project, conversation, kind) {
    const expected = await snapshot();
    const inputNode = await input.elementHandle();
    assert.ok(expected.turns > 0, "A saved conversation with messages must be open");
    assert.equal(await project.getAttribute("aria-expanded"), "true");
    await project.click();
    await page.waitForTimeout(380);
    assert.equal(await project.getAttribute("aria-expanded"), "false");
    assert.deepEqual(await snapshot(), expected, `${kind}: collapsing keeps the open conversation`);
    await project.click();
    await page.waitForTimeout(380);
    assert.equal(await project.getAttribute("aria-expanded"), "true");
    assert.deepEqual(await snapshot(), expected, `${kind}: expanding must not start a new draft`);
    assert.equal(
      await input.evaluate((element, previous) => element === previous, inputNode),
      true,
      "The same composer instance must remain mounted",
    );
    if (kind === "ACP") assert.equal(await conversation.getAttribute("aria-current"), "page");
    else
      assert.equal(
        await conversation.evaluate((row) => row.classList.contains("bg-selected")),
        true,
      );
  }

  await expand(main);
  const worktreeContent = list.locator(`[data-project-workspace-path="${mainPath}"]`);
  const acpRow = worktreeContent
    .locator("[data-acp-session-id]")
    .filter({ has: page.locator(`[data-worktree-path="${worktreePath}"]`) })
    .first();
  await acpRow.waitFor();
  const savedAcpId = await acpRow.getAttribute("data-acp-session-id");
  const savedAcpSelector = `[data-acp-session-id="${savedAcpId}"]`;
  const savedAcp = worktreeContent.locator(savedAcpSelector);
  assert.equal(await savedAcp.locator(`[data-worktree-path="${worktreePath}"]`).count(), 1);
  await savedAcp.click();
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("aria-current") === "page" &&
      document.querySelectorAll(
        '[data-testid="v4-session-pane-workspace-main"] [data-v4-turn-unit]',
      ).length > 0,
    savedAcpSelector,
  );
  const originalAcpInput = await input.textContent();
  assert.equal(originalAcpInput, "", "Do not replace an existing ACP input");
  try {
    await input.fill("worktree-selection-e2e-unsent");
    await assertFoldPreservesConversation(main, savedAcp, "ACP");
  } finally {
    await expand(main);
    if ((await savedAcp.getAttribute("aria-current")) !== "page") await savedAcp.click();
    await input.fill(originalAcpInput);
  }

  const mainContent = main.locator("xpath=ancestor::li[1]");
  const nativeRow = mainContent.locator('[data-testid^="task-item-"]').first();
  await nativeRow.waitFor();
  const nativeId = (await nativeRow.getAttribute("data-testid")).slice("task-item-".length);
  await nativeRow.click();
  await page.waitForFunction((sessionId) => {
    const element = document.querySelector('[data-testid="v4-session-pane-workspace-main"]');
    return (
      element?.getAttribute("data-session-id") === sessionId &&
      element.querySelectorAll("[data-v4-turn-unit]").length > 0
    );
  }, nativeId);
  const originalApiInput = await input.textContent();
  assert.equal(originalApiInput, "", "Do not replace an existing API input");
  try {
    await input.fill("api-selection-e2e-unsent");
    await assertFoldPreservesConversation(main, nativeRow, "API");
  } finally {
    await expand(main);
    if ((await pane.getAttribute("data-session-id")) !== nativeId) await nativeRow.click();
    await input.fill(originalApiInput);
  }

  // 活动工作树属于父项目；父项目关闭后，从另一个项目展开它仍应走原有新草稿入口。
  await savedAcp.click();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute("aria-current") === "page",
    savedAcpSelector,
  );
  await main.click();
  const unrelatedSelector = await list.evaluate(
    (element, paths) => {
      const row = [...element.querySelectorAll('[data-testid^="workspace-item-"]')].find(
        (item) =>
          item.getAttribute("data-testid") !== `workspace-item-${paths.mainPath}` &&
          item.getAttribute("data-testid") !== `workspace-item-${paths.worktreePath}`,
      );
      return row?.getAttribute("data-testid");
    },
    { mainPath, worktreePath },
  );
  assert.ok(unrelatedSelector, "An unrelated opened project is required for navigation regression");
  // Use the exact project row, rather than a descendant locator, for its collapsed state.
  const other = list.getByTestId(unrelatedSelector);
  if ((await other.getAttribute("aria-expanded")) === "true") await other.click();
  await other.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="v4-timeline"]')?.querySelectorAll("[data-v4-turn-unit]")
        .length === 0 && !document.querySelector('[data-acp-session-id][aria-current="page"]'),
  );
  await main.click();
  await page.waitForTimeout(380);
  assert.equal(await pane.getAttribute("data-session-id"), "draft");
  assert.equal(
    (await snapshot()).turns,
    0,
    "Opening a different project still starts its new draft",
  );
  assert.equal(await savedAcp.getAttribute("aria-current"), null);
  await savedAcp.click();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute("aria-current") === "page",
    savedAcpSelector,
  );
  process.stdout.write(
    "PASS: flat worktree ACP and project API retain selection, transcript and unsent input across project collapse; unrelated project navigation retained.\n",
  );
} finally {
  await browser.close();
}
