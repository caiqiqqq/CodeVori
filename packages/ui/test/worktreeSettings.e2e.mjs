// Run against an open Worktrees settings page in ZCode Dev:
// node packages/ui/test/worktreeSettings.e2e.mjs
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

  const input = page.getByRole("textbox", { name: /^(工作树目录|Worktree directory)$/ });
  if ((await input.count()) === 0) {
    const settings = page.getByRole("button", { name: /^(设置|Settings)$/ });
    if ((await settings.count()) === 1) {
      await settings.click();
    }
    const worktrees = page.getByRole("button", { name: /^(工作树|Worktrees)$/ });
    if ((await worktrees.count()) === 1) {
      await worktrees.click();
    }
  }
  assert.equal(await input.count(), 1, "Open Worktrees settings before running this scenario");
  assert.equal(
    await page
      .getByRole("button", { name: /^(恢复默认目录|Reset to the default directory)$/ })
      .count(),
    0,
    "The worktree directory has no trailing reset button",
  );

  const card = input.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
  const inputBounds = await input.boundingBox();
  const cardBounds = await card.boundingBox();
  assert.ok(inputBounds && cardBounds, "The directory input and settings card must be visible");
  assert.ok(
    inputBounds.width >= cardBounds.width * (cardBounds.width >= 640 ? 0.4 : 0.8),
    "The directory input must use the available width on desktop and narrow screens",
  );

  process.stdout.write("PASS: Worktrees directory input is wide and has no reset button.\n");
} finally {
  await browser.close();
}
