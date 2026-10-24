import assert from "node:assert/strict";

export async function assertTimelineTouchScroll({ page, width, switchView }) {
  // A history response must preserve the latest reading position, including movement
  // after request admission. A synchronous prepend cannot expose this stale-anchor bug.
  for (const yDistance of [220, -220]) {
    await switchView(`delayed-prepend-${yDistance}`, "shifted");
    await page.evaluate(async () => {
      window.__scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
      window.__scroll.scrollTop = 600;
      window.__scroll.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => {
        let frames = 0;
        const step = () => (++frames === 18 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      });
      window.__allowOlder();
    });
    await page.waitForFunction(
      () => document.querySelector("[data-ready]")?.getAttribute("data-allow-older") === "true",
    );
    await page.evaluate(() => {
      window.__deferOlder = true;
      window.__scroll.dispatchEvent(new Event("scroll"));
    });
    await page.waitForFunction(() => window.__scroll.dataset.loadingOlder === "true");
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.synthesizeScrollGesture", {
      x: Math.min(width - 30, 200),
      y: 300,
      yDistance,
      speed: 500,
      gestureSourceType: "touch",
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const step = () => (++frames === 18 ? resolve() : requestAnimationFrame(step));
          requestAnimationFrame(step);
        }),
    );
    const latestAnchor = await page.evaluate(() => {
      const viewport = window.__scroll.getBoundingClientRect();
      const node = [
        ...document.querySelectorAll("[data-v4-timeline-virtual-history] > [data-v4-turn-unit]"),
      ].find((node) => node.getBoundingClientRect().bottom > viewport.top);
      return {
        id: node.dataset.turnId,
        top: node.getBoundingClientRect().top,
        scrollTop: window.__scroll.scrollTop,
      };
    });
    assert.ok(
      Math.abs(latestAnchor.scrollTop - (600 - yDistance)) <= 10,
      "Touch gesture moves reading position in either direction while history is pending",
    );
    await page.evaluate(() => window.__commitOlder());
    await page.waitForFunction(
      () => document.querySelector("[data-ready]")?.getAttribute("data-kind") === "prepend",
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const latestAnchorTop = await page
      .locator(`[data-v4-turn-unit][data-turn-id="${latestAnchor.id}"]`)
      .evaluate((node) => node.getBoundingClientRect().top);
    assert.ok(
      Math.abs(latestAnchorTop - latestAnchor.top) <= 2,
      `Delayed prepend preserves latest touch position: ${latestAnchor.top} -> ${latestAnchorTop}`,
    );
    await touch.detach();
  }
  await switchView("continuous-touch", "largeMedium");
  const gesture = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.__touchFrames = [];
    window.__trackTouch = true;
    const sample = () => {
      const viewport = window.__scroll.getBoundingClientRect();
      const visible = [
        ...document.querySelectorAll("[data-v4-timeline-virtual-history] > [data-v4-turn-unit]"),
      ].filter(
        (node) =>
          node.getBoundingClientRect().bottom > viewport.top &&
          node.getBoundingClientRect().top < viewport.bottom,
      );
      window.__touchFrames.push({
        top: window.__scroll.scrollTop,
        first: visible.length ? Number(visible[0].dataset.index) : null,
      });
      if (window.__trackTouch) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await gesture.send("Input.synthesizeScrollGesture", {
    x: Math.min(width - 30, 200),
    y: 250,
    yDistance: 16000,
    speed: 8000,
    gestureSourceType: "touch",
  });
  const touchFrames = await page.evaluate(() => {
    window.__trackTouch = false;
    return window.__touchFrames;
  });
  const skips = touchFrames.flatMap((frame, index) => {
    const previous = touchFrames[index - 1];
    return previous &&
      (frame.first === null ||
        (previous.first !== null && Math.abs(frame.first - previous.first) > 1))
      ? [{ previous, frame }]
      : [];
  });
  assert.deepEqual(
    skips,
    [],
    "Continuous touch scroll must not skip turns while measuring cold history",
  );
  assert.ok(
    touchFrames[0].first - touchFrames.at(-1).first > 8,
    "Gesture crosses the measured overscan window",
  );
  await gesture.detach();
}
