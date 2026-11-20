import assert from "node:assert/strict";

export async function assertProgrammaticScrollKeepsTailWindow({ page, timeline }) {
  assert.equal(await timeline.getAttribute("data-row-count"), "60");
  await timeline.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  assert.equal(await timeline.getAttribute("data-row-count"), "60");
}

export async function assertUserScrollLoadsOnePage({ page, timeline }) {
  await timeline.hover();
  await page.mouse.wheel(0, -100_000);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="v4-timeline"]')?.getAttribute("data-row-count") ===
      "120",
  );
  await page.waitForTimeout(300);
  assert.equal(await timeline.getAttribute("data-row-count"), "120");
}

export async function exerciseOlderNavigatorQuery({
  page,
  rail,
  timeline,
  tooltip,
  query,
  totalRows,
}) {
  await rail.evaluate((element) => {
    element.firstElementChild.scrollTop = 0;
  });
  await query(0).waitFor();
  await query(0).hover();
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /codex question 0.*codex answer 0/s);
  assert.equal(await query(0).getAttribute("data-unit-index"), "-1");
  assert.equal(await query(0).getAttribute("data-query-row-id"), "2");
  await query(0).click();
  await page.waitForFunction((expectedRows) => {
    const scroll = document.querySelector('[data-testid="v4-timeline"]');
    const row = scroll?.querySelector('[data-row-id="2"]');
    return (
      scroll?.getAttribute("data-row-count") === String(expectedRows) &&
      row &&
      Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 3
    );
  }, totalRows);
  assert.equal(await query(0).getAttribute("data-active"), "true");
  assert.equal(await timeline.getAttribute("data-row-count"), String(totalRows));
}
