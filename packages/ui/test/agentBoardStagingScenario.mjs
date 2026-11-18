import assert from "node:assert/strict";

export async function exerciseAgentBoardStaging(page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const f = window.__board;
    f.update(0, {
      liveStatus: "completed",
      updatedAt: 4000,
      activity: { phase: "completedSuccess", hasBackgroundWork: false },
    });
    f.updateAcp(0, { status: "idle" });
    f.updateAcp(1, { status: "interrupted" });
    const s = f.store.getState();
    s.selectProject(null);
    s.setView("all");
    s.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [
        JSON.stringify(["remote:0", "native", "same-id"]),
        JSON.stringify(["remote:0", "acp", "same-id"]),
        JSON.stringify(["remote:1", "acp", "same-id"]),
      ],
      excludedItems: [],
    });
  });
  const cards = page.locator("[data-board-card]");
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 3);
  for (const card of await cards.all()) {
    assert.equal(await card.locator(":scope > div").count(), 0, "card has no bottom action row");
    assert.equal(await card.getByRole("button", { name: /暂存|移出暂存|拖动到暂存/ }).count(), 0);
    assert.equal(await card.getByText("remote:0", { exact: true }).count(), 0);
  }

  await page.evaluate(() => {
    const itemKey = JSON.stringify(["remote:0", "native", "same-id"]);
    window.__board.store.setState({
      stagedItems: { [itemKey]: { updatedAt: 4000, outcome: "completed" } },
    });
    window.__board.store.getState().setView("staged");
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-board-column="staged"] [data-board-card]').length === 1,
  );
  assert.equal(await page.locator('[data-board-column="staged"] [data-board-card]').count(), 1);
}
