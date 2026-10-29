import assert from "node:assert/strict";

export async function assertBoardFavoritesRemoved(page) {
  assert.equal(await page.getByRole("tab", { name: /收藏/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /收藏/ }).count(), 0);
  assert.equal(await page.locator("article svg.lucide-star").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.__board.commands.some((c) => c.mutation?.kind === "pin" || c.action?.kind === "pin"),
    ),
    false,
  );
}

export async function assertLegacyFavoriteMigration(page) {
  await assertBoardFavoritesRemoved(page);
  assert.equal(
    await page.getByRole("tab", { name: /^全部/ }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Implement project 6", exact: true }).count(),
    1,
    "previously pinned native member remains visible",
  );
  assert.equal(await page.evaluate(() => window.__board.native[6].pinned), true);
}
