// Read-only UI flow against a running ZCode Dev window; delete is always cancelled.
// ZCODE_E2E_WORKTREE_PATH=/path/to/registered/worktree node packages/ui/test/worktreeManagement.e2e.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP(
  process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229",
);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes(":5174/"));
  assert.ok(page, "ZCode Dev renderer must be running on port 5174");
  if ((await page.getByTestId("managed-worktrees").count()) === 0) {
    await page
      .getByRole("button", { name: /^(设置|Settings)$/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^(工作树|Worktrees)$/ })
      .first()
      .click();
  }
  const list = page.getByTestId("managed-worktrees");
  await list.waitFor();
  const tree = list.getByTestId("managed-worktree").first();
  await tree.waitFor({ timeout: 10_000 });
  assert.equal(await list.getByRole("alert").count(), 0, "Managed worktrees must load");
  if (process.env.ZCODE_E2E_WORKTREE_PATH) {
    assert.equal(
      await tree.locator("[title]").first().getAttribute("title"),
      process.env.ZCODE_E2E_WORKTREE_PATH,
    );
  }

  const buttons = tree.locator("button");
  const hasConversation = (await buttons.count()) > 2;
  await buttons.nth(1).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
  await dialog.waitFor();
  assert.match((await dialog.textContent()) ?? "", /分支|branch/i);
  await dialog.locator("button").first().click();
  assert.equal(await list.getByTestId("managed-worktree").count(), 1);

  if (hasConversation) {
    await tree.locator("button").nth(2).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="managed-worktrees"]') &&
        Boolean(
          document
            .querySelector('[data-testid="v4-session-pane-workspace-main"]')
            ?.getAttribute("data-session-id"),
        ),
    );
    assert.ok(
      (await page
        .getByTestId("v4-session-pane-workspace-main")
        .locator("[data-v4-turn-unit]")
        .count()) > 0,
      "Selecting a saved conversation must show its transcript",
    );
    await page
      .getByRole("button", { name: /^(设置|Settings)$/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^(工作树|Worktrees)$/ })
      .first()
      .click();
    await page.getByTestId("managed-worktree").first().locator("button").first().click();
    await page.getByTestId("managed-worktrees").waitFor({ state: "detached" });
    assert.equal(
      await page
        .getByTestId("v4-session-pane-workspace-main")
        .locator("[data-v4-turn-unit]")
        .count(),
      0,
      "New conversation must open an empty draft",
    );
    // 离开测试时恢复原历史会话，不保留测试产生的空草稿作为当前对话。
    await page
      .getByRole("button", { name: /^(设置|Settings)$/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^(工作树|Worktrees)$/ })
      .first()
      .click();
    await page.getByTestId("managed-worktree").first().locator("button").nth(2).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-testid="v4-session-pane-workspace-main"] [data-v4-turn-unit]',
        ).length > 0,
    );
  }
  process.stdout.write("PASS: scoped worktree list, delete cancellation, history and new draft.\n");
} finally {
  await browser.close();
}
