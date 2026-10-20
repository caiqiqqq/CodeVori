import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertDelegationSettings(page, shots, width) {
  const section = page.getByTestId("delegation-settings");
  const concurrency = section.getByLabel("项目并行任务数");
  const enabled = section.getByRole("switch", { name: "启用委托" });
  const depth = section.getByLabel("最大委托深度");
  const cache = section.getByLabel("已完成结果缓存（MB）");
  const wait = async (expected) => {
    try {
      await page.waitForFunction(
        (expected) =>
          Object.entries(expected).every(
            ([key, value]) => window.__delegation.settings[key] === value,
          ) &&
          document.getElementById("delegation-concurrency")?.value ===
            String(expected.concurrency) &&
          document.getElementById("delegation-depth")?.value ===
            String(expected.allowNested ? expected.maxDepth : 1) &&
          document.getElementById("delegation-enabled")?.getAttribute("aria-checked") ===
            String(expected.enabled) &&
          document.getElementById("delegation-cache-mb")?.value ===
            String(expected.completedCacheMaxMb),
        expected,
      );
    } catch (error) {
      const actual = await page.evaluate(() => ({
        settings: window.__delegation.settings,
        inputs: ["delegation-depth", "delegation-cache-mb", "delegation-concurrency"].map((id) => ({
          id,
          value: document.getElementById(id)?.value,
        })),
        enabled: document.getElementById("delegation-enabled")?.getAttribute("aria-checked"),
        call: window.__delegation.calls.filter((call) => call.op === "settings").at(-1),
      }));
      throw new Error(`Settings did not converge: ${JSON.stringify({ expected, actual })}`, {
        cause: error,
      });
    }
    assert.equal(await concurrency.inputValue(), String(expected.concurrency));
    assert.equal(await depth.inputValue(), String(expected.allowNested ? expected.maxDepth : 1));
    assert.equal(await enabled.getAttribute("aria-checked"), String(expected.enabled));
    assert.equal(await cache.inputValue(), String(expected.completedCacheMaxMb));
  };
  assert.equal(await depth.isVisible(), true);
  assert.equal(await depth.isEnabled(), true);
  assert.equal(await depth.inputValue(), "1");
  assert.equal(await cache.inputValue(), "512");
  assert.equal(await section.getByRole("button", { name: "保存" }).count(), 0);
  assert.equal(await section.getByRole("switch").count(), 1);

  const expected = {
    enabled: true,
    concurrency: 8,
    allowNested: true,
    maxDepth: 8,
    completedCacheMaxMb: 512,
  };
  await depth.fill("8");
  await depth.press("Tab");
  await wait(expected);
  await section.locator("p").first().click();
  await section.screenshot({
    path: join(shots, `delegation-settings-${width}.png`),
    animations: "disabled",
  });
  const originalTheme = await page.evaluate(() => document.documentElement.className);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.classList.remove("dark", "theme-zai-dark", "theme-zai-light");
      document.documentElement.classList.add(`theme-zai-${theme}`);
      if (theme === "dark") document.documentElement.classList.add("dark");
    }, theme);
    await section.screenshot({
      path: join(shots, `delegation-settings-${theme}-${width}.png`),
      animations: "disabled",
    });
    for (const control of [enabled, depth, cache, concurrency]) {
      const box = await control.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width,
        `${theme}: control must fit viewport`,
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
  }
  await page.evaluate((theme) => (document.documentElement.className = theme), originalTheme);

  await cache.fill("0");
  await cache.press("Tab");
  expected.completedCacheMaxMb = 0;
  await wait(expected);
  await enabled.click();
  expected.enabled = false;
  await wait(expected);
  for (const control of [depth, cache, concurrency]) assert.equal(await control.isDisabled(), true);
  await enabled.click();
  expected.enabled = true;
  await wait(expected);
  await concurrency.fill("3");
  await concurrency.press("Tab");
  Object.assign(expected, { concurrency: 3, maxDepth: 3 });
  await wait(expected);
  await depth.fill("1");
  await depth.press("Tab");
  Object.assign(expected, { allowNested: false, maxDepth: 1 });
  await wait(expected);

  await page.evaluate(() => {
    window.__delegation.holdNextSettings = true;
  });
  await depth.fill("4");
  await depth.press("Tab");
  await page.waitForFunction(() => typeof window.__delegation.resolveSettings === "function");
  await cache.fill("512");
  await enabled.click();
  await page.evaluate(() => window.__delegation.resolveSettings());
  Object.assign(expected, {
    enabled: false,
    concurrency: 4,
    allowNested: true,
    maxDepth: 4,
    completedCacheMaxMb: 512,
  });
  await wait(expected);
  await enabled.click();
  await concurrency.fill("3");
  await concurrency.press("Tab");
  await depth.fill("3");
  await depth.press("Tab");
  Object.assign(expected, { enabled: true, concurrency: 3, maxDepth: 3 });
  await wait(expected);

  for (const invalid of ["", "0", "9", "2.5"]) {
    const before = await page.evaluate(
      () => window.__delegation.calls.filter((call) => call.op === "settings").length,
    );
    await depth.fill(invalid);
    await depth.press("Tab");
    await page.waitForFunction(() => document.getElementById("delegation-depth")?.value === "3");
    assert.equal(
      await page.evaluate(
        () => window.__delegation.calls.filter((call) => call.op === "settings").length,
      ),
      before,
    );
  }
  for (const invalid of ["", "-1", "0.5", "4294967296"]) {
    const before = await page.evaluate(
      () => window.__delegation.calls.filter((call) => call.op === "settings").length,
    );
    await cache.fill(invalid);
    await cache.press("Tab");
    await page.waitForFunction(
      () => document.getElementById("delegation-cache-mb")?.value === "512",
    );
    assert.equal(
      await page.evaluate(
        () => window.__delegation.calls.filter((call) => call.op === "settings").length,
      ),
      before,
    );
  }
  await page.evaluate(() => {
    window.__delegation.rejectNextSettings = true;
  });
  await depth.fill("4");
  await depth.press("Tab");
  await section.getByRole("alert").waitFor();
  await wait(expected);
  await depth.fill("8");
  await depth.press("Tab");
  Object.assign(expected, { concurrency: 8, maxDepth: 8 });
  await wait(expected);
  assert.equal(await section.getByRole("alert").count(), 0);

  await page.evaluate(() => window.__delegation.remountSettings());
  await depth.waitFor();
  await wait(expected);
  assert.equal(await enabled.getAttribute("aria-checked"), "true");

  const navigation = page.getByTestId("delegation-settings-navigation");
  assert.equal(await navigation.getByRole("button", { name: "多智能体协同" }).count(), 1);
  await navigation.getByRole("button", { name: "Agent SDK 管理", exact: true }).click();
  await page.getByTestId("settings-acp-agents").waitFor();
  assert.equal(await section.count(), 0, "SDK management no longer mounts collaboration settings");
  assert.equal(await page.getByLabel("最大委托深度").count(), 0);
  await navigation.getByRole("button", { name: "多智能体协同", exact: true }).click();
  await section.waitFor();
  await wait(expected);
  assert.equal(await page.getByTestId("settings-acp-agents").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "多智能体协同", exact: true }).count(), 1);
  await page.evaluate(() => window.__delegation.reopenSettings());
  await wait(expected);
  assert.equal(
    await page.getByTestId("delegation-settings-section").getAttribute("data-section"),
    "delegation",
  );
  await page.evaluate(() => window.__delegation.openSettingsIntent("acpAgents"));
  await page.getByTestId("settings-acp-agents").waitFor();
  assert.equal(await section.count(), 0, "explicit navigation intent overrides remembered section");
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("zcode-settings-section-intent")),
    null,
  );
  await navigation.getByRole("button", { name: "多智能体协同", exact: true }).click();
  await page.evaluate(() => window.__delegation.reopenSettings());
  await section.waitFor();
  await wait(expected);
  assert.equal(
    await page.getByTestId("settings-acp-agents").count(),
    0,
    "navigation intent is consumed once",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
    }, theme);
    await page.getByTestId("delegation-settings-section").screenshot({
      path: join(shots, `delegation-settings-navigation-${theme}-${width}.png`),
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await page.evaluate((theme) => (document.documentElement.className = theme), originalTheme);
}
