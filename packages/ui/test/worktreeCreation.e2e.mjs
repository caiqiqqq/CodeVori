// Run against an open local Git workspace in ZCode Dev:
// node packages/ui/test/worktreeCreation.e2e.mjs
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

  const branchTrigger = page
    .getByRole("button", { name: /^(切换 Git 分支|Switch Git branch)$/ })
    .first();
  assert.equal(await branchTrigger.count(), 1, "Open a local Git workspace before this scenario");
  await branchTrigger.click();
  await page.getByRole("button", { name: /^(新建工作树|New worktree)$/ }).click();
  assert.equal(
    await page.getByRole("dialog", { name: /^(创建工作树|Create worktree)$/ }).count(),
    0,
  );
  assert.equal(await page.getByTestId("worktree-draft-selected").count(), 1);
  await page
    .getByRole("button", { name: /^(切换 Git 分支|Switch Git branch)$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^(取消新建工作树|Cancel new worktree)$/ }).click();
  assert.equal(await page.getByTestId("worktree-draft-selected").count(), 0);

  process.stdout.write(
    "PASS: Worktree draft selection shows inline without creating or opening a dialog.\n",
  );
} finally {
  await browser.close();
}
