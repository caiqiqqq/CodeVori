import assert from "node:assert/strict";

export async function assertBoardMessagePreviewsHidden(page) {
  for (const title of ["Remote ACP 0", "Remote ACP 1"]) {
    const card = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    assert.doesNotMatch(
      await card.textContent(),
      /Review remote implementation/,
      "latest user message is not a card summary",
    );
    assert.equal(await card.getByRole("heading", { name: title, exact: true }).count(), 1);
  }
}
