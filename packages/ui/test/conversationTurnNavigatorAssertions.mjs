import assert from "node:assert/strict";

export function createTurnNavigatorAssertions(page, errors) {
  const rail = page.getByTestId("v4-turn-navigator");
  const timeline = page.getByTestId("v4-timeline");
  const query = (index) => rail.locator(`[data-item-index="${index}"]`);
  const activeQuery = async (index) => {
    await page.waitForFunction(
      (index) =>
        document
          .querySelector('[data-testid="v4-turn-navigator"] [data-active="true"]')
          ?.getAttribute("data-item-index") === String(index),
      index,
    );
    assert.equal(await query(index).getAttribute("aria-current"), "location");
    // 真实 rail 会虚拟化目录；最新项必须在滚动窗口内，而非仅在 DOM 中存在。
    assert.equal(
      await query(index).evaluate((element) => {
        const viewport = element.closest("nav").firstElementChild.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
      }),
      true,
    );
  };
  const toBottom = async () => {
    await page.getByRole("button", { name: "滚动到底部", exact: true }).click();
  };
  const visibleQueries = () =>
    timeline.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      return [...element.querySelectorAll("[data-v4-user-input-bubble]")].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
      }).length;
    });
  const directory = async (count) => {
    await page
      .waitForFunction(
        (count) =>
          document
            .querySelector('[data-testid="v4-turn-navigator"]')
            ?.getAttribute("data-item-count") === String(count),
        count,
      )
      .catch((error) => {
        throw new Error(`${error.message}; page errors=${errors.join("; ")}`);
      });
    assert.equal(await rail.isVisible(), true);
  };
  return { activeQuery, toBottom, visibleQueries, directory };
}
