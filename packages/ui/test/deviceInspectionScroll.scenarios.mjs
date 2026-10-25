import assert from "node:assert/strict";

export async function verifyInspectionTableScroll({ page, details, screenshotPath }) {
  const table = details.getByTestId("device-inspection-processes");
  const viewport = table.locator("..");
  const header = table.locator("thead");
  await viewport.scrollIntoViewIfNeeded();
  assert.ok(
    await viewport.evaluate((el) => el.scrollHeight > el.clientHeight),
    "Fixture must exercise an overflowing process list",
  );
  const before = await header.boundingBox();
  // Compare the painted heading interior, excluding borders and rounded viewport corners.
  const headingPixels = async () => {
    const box = await header.boundingBox();
    const visible = await viewport.boundingBox();
    const x = Math.max(box.x, visible.x) + 4;
    const right = Math.min(box.x + box.width, visible.x + visible.width) - 4;
    return page.screenshot({
      clip: { x, y: box.y + 4, width: right - x, height: box.height - 8 },
      animations: "disabled",
    });
  };
  const originalPixels = await headingPixels();
  await viewport.hover();
  await page.mouse.wheel(0, 160);
  await page.waitForFunction(() => {
    const table = document.querySelector('[data-testid="device-inspection-processes"]');
    return table?.parentElement.scrollTop >= 150;
  });
  const after = await header.boundingBox();
  assert.ok(Math.abs(after.y - before.y) <= 1, "Process headings must remain fixed");
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  assert.ok(
    originalPixels.equals(await headingPixels()),
    "Scrolled process rows must not paint over or show through the headings",
  );
  assert.equal(
    await header.evaluate((el) => {
      const header = el.getBoundingClientRect();
      const viewport = el.closest("table").parentElement.getBoundingClientRect();
      const target = document.elementFromPoint(
        Math.max(header.left, viewport.left) + 10,
        header.top + header.height / 2,
      );
      return el.contains(target);
    }),
    true,
    "Process headings must remain above row hit targets",
  );
  if (await viewport.evaluate((el) => el.scrollWidth > el.clientWidth)) {
    await page.mouse.wheel(180, 0);
    await page.waitForFunction(() => {
      const table = document.querySelector('[data-testid="device-inspection-processes"]');
      return table?.parentElement.scrollLeft > 0;
    });
    assert.equal(
      await table.evaluate((el) => {
        const headings = [...el.querySelectorAll("th")];
        const cells = [...el.querySelector("tbody tr").children];
        return headings.every((heading, index) => {
          const a = heading.getBoundingClientRect();
          const b = cells[index].getBoundingClientRect();
          return Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1;
        });
      }),
      true,
      "Horizontal scrolling must preserve heading and cell alignment",
    );
    assert.ok(Math.abs((await header.boundingBox()).y - before.y) <= 1);
  }
}
