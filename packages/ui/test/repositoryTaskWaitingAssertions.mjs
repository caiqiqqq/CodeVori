import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseRepositoryTaskWaiting(page, panel, artifacts) {
  const waiting = page.getByTestId("repository-task-preparation");
  const editor = page.getByTestId("work-task-editor");
  const handle = () => panel.getByTestId("repository-item-handle").first();
  const writes = () =>
    page.evaluate(
      () =>
        window.__forge.calls.filter((c) => /attachment-(begin|commit)|task-create/.test(c.op))
          .length,
    );
  const before = await writes();
  const cancel = async () => {
    await waiting.getByRole("button", { name: "取消", exact: true }).click();
    await waiting.waitFor({ state: "detached" });
    assert.equal(await handle().isEnabled(), true);
  };
  await page.evaluate(() => {
    window.__forge.delayDetail = true;
  });
  await handle().click();
  await waiting.getByRole("status").getByText("正在读取议题内容…").waitFor();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await cancel();
  await page.evaluate(() => {
    window.__forge.delayDetail = true;
  });
  await handle().click();
  await page.waitForFunction(() => window.__forge.pending.length === 2);
  const readCount = await page.evaluate(() => window.__forge.imageReads.length);
  await page.evaluate(() => window.__forge.finish());
  await waiting.getByText("正在读取议题内容…").waitFor();
  assert.equal(await editor.count(), 0);
  assert.equal(
    await page.evaluate(() => window.__forge.imageReads.length),
    readCount,
    "cancelled detail cannot start an image read",
  );
  await page.evaluate(() => window.__forge.finish());
  await editor.waitFor();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "detached" });

  const originalBody = await page.evaluate(() => window.__forge.imageBody);
  await page.evaluate(() => {
    window.__forge.imageBody +=
      "\n\n![new screenshot](" + window.__forge.imageUrl.replace(/abc$/, "abd") + ")";
    window.__forge.delayImage = true;
  });
  await handle().click();
  await waiting.getByRole("status").getByText("正在准备截图（0/2）…").waitFor();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await page.evaluate(() => {
    window.__forge.delayImage = true;
    window.__forge.finish();
  });
  await waiting.getByText("正在准备截图（1/2）…").waitFor();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await cancel();
  // A new preparation must survive the cancelled one's late screenshot response.
  await page.evaluate(() => {
    window.__forge.delayDetail = true;
  });
  await handle().click();
  await page.waitForFunction(() => window.__forge.pending.length === 2);
  await page.evaluate(() => window.__forge.finish());
  await waiting.getByText("正在读取议题内容…").waitFor();
  assert.equal(await editor.count(), 0);
  await page.evaluate(() => window.__forge.finish());
  await editor.waitFor();
  assert.equal(await editor.getByTestId("work-task-attachment").count(), 2);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await writes(), before);
  await page.evaluate((body) => {
    window.__forge.imageBody = body;
  }, originalBody);

  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => {
        window.__forge.delayImage = true;
      });
      await handle().click();
      await waiting.getByText("正在准备截图（0/1）…").waitFor();
      await page.waitForFunction(() => window.__forge.pending.length === 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const spinner = waiting.locator("svg.animate-spin");
      assert.equal(await spinner.getAttribute("aria-hidden"), "true");
      await page.mouse.move(1, 849);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: join(artifacts, `issue-waiting-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await waiting.waitFor({ state: "detached" });
      await page.evaluate(() => window.__forge.finish());
      assert.equal(await editor.count(), 0);
    }
  }
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    document.documentElement.className = "theme-zai-light";
  });
}
