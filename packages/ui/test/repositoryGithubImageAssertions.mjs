import assert from "node:assert/strict";

export async function assertRepositoryGithubImages({ page, panel, artifacts }) {
  let anonymousReads = 0;
  await page.route("https://github.com/user-attachments/**", (route) => {
    anonymousReads += 1;
    return route.abort();
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.evaluate(() => window.__detail.showGithub());
  await panel.getByTestId("repository-item-row").first().click();
  const detail = panel.getByTestId("repository-item-detail");
  const images = detail.getByTestId("repository-inline-image");
  await detail.getByTestId("repository-image").getByRole("alert").waitFor();
  assert.equal(await detail.getByRole("button", { name: "登录 GitLab", exact: true }).count(), 0);
  await detail
    .getByTestId("repository-image")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="repository-inline-image"]')];
    return images.length === 2 && images.every((img) => img.naturalWidth === 800);
  });
  assert.equal(
    await images.count(),
    2,
    "Both description HTML image and comment Markdown image load",
  );
  assert.deepEqual(
    await images.first().evaluate((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(100, 100, 1, 1).data];
    }),
    [22, 135, 75, 255],
  );
  assert.ok((await images.first().getAttribute("src")).startsWith("blob:"));
  const calls = await page.evaluate(() =>
    window.__detail.calls.filter(
      (c) => c.op === "image" && c.url.startsWith("https://github.com/"),
    ),
  );
  assert.ok(calls.length >= 3);
  assert.ok(
    calls.every(
      (c) => c.host === "B" && c.workspacePath === "/synthetic/B" && c.repositoryKey === "B",
    ),
  );
  const preview = page.getByTestId("repository-image-preview");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((value) => window.__detail.setTheme(value), theme);
      await images.first().scrollIntoViewIfNeeded();
      const bounds = await images.first().boundingBox();
      assert.ok(Math.abs(bounds.width / bounds.height - 2) < 0.02);
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await images.first().click();
      await preview.waitFor();
      await preview.getByRole("button", { name: "放大", exact: true }).click();
      await preview.getByText("150%", { exact: true }).waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: `${artifacts}/github-image-${width}-${theme}.png` });
      await page.keyboard.press("Escape");
      await preview.waitFor({ state: "detached" });
    }
  }
  await page.evaluate(() => {
    window.__detail.delayImage = true;
    window.__detail.switchHost("A");
  });
  await panel.getByTestId("repository-item-row").first().click();
  await page.waitForFunction(() => window.__detail.pendingImages.length === 1);
  await page.evaluate(() => window.__detail.switchHost("B"));
  await panel.getByTestId("repository-item-row").first().click();
  await page.evaluate(() => window.__detail.pendingImages.shift()());
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[data-testid="repository-inline-image"]')];
    return images.length === 2 && images.every((image) => image.naturalWidth === 800);
  });
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "image").at(-1).host),
    "B",
  );
  assert.equal(
    anonymousReads,
    0,
    "GitHub attachment URLs must never be loaded anonymously in Renderer",
  );
}
