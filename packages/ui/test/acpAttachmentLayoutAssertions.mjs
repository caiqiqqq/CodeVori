import assert from "node:assert/strict";

export function createAcpAttachmentLayoutAssertions(page, timeline, pixel) {
  return async (text) => {
    const row = timeline.locator('[data-row-id="2"]');
    await page.waitForFunction(
      (text) =>
        document.querySelector('[data-row-id="2"] [data-v4-user-input-bubble]')?.textContent ===
        text,
      text,
    );
    const media = row.locator("[data-v4-user-input-media-attachment]");
    assert.equal(await media.count(), 2);
    assert.equal(
      await row.locator("[data-v4-user-input-attachment-pill]").innerText(),
      "notes.txt",
    );
    assert.equal(
      await row.locator("[data-v4-user-input-bubble] [data-v4-user-input-attachments]").count(),
      0,
    );
    assert.deepEqual(await pixel(media.nth(0).locator("img")), [255, 0, 0, 255]);
    assert.deepEqual(await pixel(media.nth(1).locator("img")), [0, 0, 255, 255]);
    const layout = await row.evaluate((element) => {
      const media = element.querySelector("[data-v4-user-input-media-attachments]");
      const thumbnail = media.firstElementChild;
      const mediaRect = media.getBoundingClientRect();
      const bubbleRect = element
        .querySelector("[data-v4-user-input-bubble]")
        .getBoundingClientRect();
      const thumbnailRect = thumbnail.getBoundingClientRect();
      return {
        width: thumbnailRect.width,
        height: thumbnailRect.height,
        above: mediaRect.bottom <= bubbleRect.top,
        aligned: Math.abs(mediaRect.right - bubbleRect.right) < 2,
        radius: getComputedStyle(thumbnail).borderRadius,
      };
    });
    assert.equal(layout.width, 80);
    assert.equal(layout.height, 80);
    assert.equal(layout.above, true);
    assert.equal(layout.aligned, true);
    return layout;
  };
}
