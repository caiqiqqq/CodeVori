import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertRepositoryProjectCounts({ page, option }) {
  const count = (key) => option(key).getByTestId("repository-project-count");
  await count("/synthetic/alpha/project").locator("svg").waitFor();
  assert.match(await count("/synthetic/alpha/project").getAttribute("aria-label"), /正在获取/);
  await page.evaluate(() => window.__projects.pendingCounts.shift()());
  const expectCount = async (key, expected) => {
    await page.waitForFunction(
      ({ key, expected }) =>
        [...document.querySelectorAll('[data-testid="repository-project-option"]')]
          .find((option) => option.getAttribute("data-workspace-key") === key)
          ?.querySelector('[data-testid="repository-project-count"]')?.textContent === expected,
      { key, expected: String(expected) },
    );
  };
  await expectCount("/synthetic/alpha/project", 3);
  await expectCount("/synthetic/beta/project", 0);
  await expectCount("/synthetic/non-git", "—");
  await page.evaluate(() => {
    window.__projects.failCounts = true;
    window.__projects.refreshCounts();
  });
  await page.waitForFunction(() =>
    document
      .querySelector(
        '[data-workspace-key="/synthetic/alpha/project"] [data-testid="repository-project-count"]',
      )
      ?.getAttribute("title")
      ?.includes("未能更新"),
  );
  await expectCount("/synthetic/alpha/project", 3);
  await page.evaluate(() => {
    window.__projects.failCounts = false;
    window.__projects.counts["local:/synthetic/alpha/project"] = 2;
    for (const listener of window.__projects.countListeners.local) listener();
  });
  await expectCount("/synthetic/alpha/project", 2);
  return { count, expectCount };
}

export async function assertRepositoryProjectCountLayouts({
  page,
  picker,
  trigger,
  search,
  artifacts,
}) {
  const settleVisuals = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  for (const [theme, width] of [
    ["light", 1120],
    ["dark", 1120],
    ["light", 390],
    ["dark", 390],
    ["light", 320],
    ["dark", 320],
  ]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate((theme) => {
      window.__projects.setTheme(theme);
    }, theme);
    await trigger().click();
    await search().fill("project");
    await picker()
      .locator('[data-slot="command-list"]')
      .evaluate((node) => {
        node.scrollTop = 0;
      });
    await settleVisuals();
    assert.equal(
      await trigger()
        .locator("span")
        .first()
        .evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await page.screenshot({ path: join(artifacts, `projects-${theme}-${width}.png`) });
    await picker().screenshot({ path: join(artifacts, `project-counts-${theme}-${width}.png`) });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const bounds = await picker().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await picker().evaluate((node) => node.scrollWidth > node.clientWidth), false);
    await search().press("Escape");
    await picker().waitFor({ state: "detached" });
  }
}
