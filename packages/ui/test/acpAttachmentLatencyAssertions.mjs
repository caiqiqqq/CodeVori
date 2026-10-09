import assert from "node:assert/strict";

export async function exerciseAcpAttachmentLatency(page, timeline, pixel, attachmentLayout) {
  // 真实 IPC 会克隆每份快照：无关正文/状态变化不能重读同一张图片。
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.__turnNavigator.open("codex", 1, true, true, true));
    await attachmentLayout("codex question 0");
    const image = timeline
      .locator('[data-row-id="2"] [data-v4-user-input-media-attachment] img')
      .first();
    for (const status of ["idle", "running"]) {
      // 当前轮从 live tail 转为虚拟历史会正常重挂载；只比较同一可见行生命周期。
      await page.evaluate((status) => window.__turnNavigator.snapshot(status), status);
      await pixel(image);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const originalUrl = await image.getAttribute("src");
      const before = await page.evaluate(() => window.__turnNavigator.reads.length);
      for (let index = 0; index < 4; index++) {
        await page.evaluate((status) => window.__turnNavigator.snapshot(status), status);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      }
      assert.equal(
        await page.evaluate(() => window.__turnNavigator.reads.length),
        before,
        "cloned status/stream snapshots must retain attachment reads",
      );
      assert.equal(await image.getAttribute("src"), originalUrl, "retain the existing Blob URL");
    }
    await page.evaluate(() => window.__turnNavigator.snapshot("idle"));
    await pixel(image);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const originalUrl = await image.getAttribute("src");
    await page.evaluate(() => window.__turnNavigator.snapshot("idle", true));
    await page.waitForFunction((previous) => {
      const image = document.querySelector(
        '[data-row-id="2"] [data-v4-user-input-media-attachment] img',
      );
      return image?.src !== previous && image?.naturalWidth > 0;
    }, originalUrl);
    assert.deepEqual(
      await pixel(image),
      [0, 0, 255, 255],
      "replacement ref must load its own bytes",
    );
  }
  await page.evaluate(() => {
    window.__turnNavigator.delayReads();
    window.__turnNavigator.open("codex", 1, true, true, true);
  });
  await page.waitForFunction(() => window.__turnNavigator.pendingReads.length === 2);
  const beforePending = await page.evaluate(() => window.__turnNavigator.reads.length);
  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => window.__turnNavigator.snapshot("idle"));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  assert.equal(
    await page.evaluate(() => window.__turnNavigator.reads.length),
    beforePending,
    "cloned snapshots preserve unresolved reads too",
  );
  await page.evaluate(() => window.__turnNavigator.releaseReads());
  await attachmentLayout("codex question 0");
  await page.setViewportSize({ width: 1280, height: 800 });
}
