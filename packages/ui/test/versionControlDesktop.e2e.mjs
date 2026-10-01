// Read-only smoke against a running Desktop Host; adding credentials is always cancelled.
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP(
  process.env.ZCODE_E2E_CDP_URL ?? "http://127.0.0.1:9229",
);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes(":5174/"));
  assert.ok(page, "ZCode Dev renderer must be running");
  const panel = page.getByTestId("version-control-settings");
  if (!(await panel.count())) {
    const section = page.getByRole("button", { name: /^(版本控制|Version Control)$/ });
    if (!(await section.count()))
      await page
        .getByRole("button", { name: /^(设置|Settings)$/ })
        .first()
        .evaluate((button) => button.click());
    await section.waitFor();
    await section.evaluate((button) => button.click());
  }
  await panel.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="version-control-settings"]')
        ?.getAttribute("aria-busy") === "false",
  );
  assert.equal(
    await panel.getByRole("alert").count(),
    0,
    "Actual Host must support the new Git settings methods",
  );
  assert.equal(await panel.locator("section[data-testid]").count(), 4);
  assert.equal(await page.locator("#vc-git-path").isDisabled(), false);
  assert.match(await panel.locator('section[aria-label="Git"]').textContent(), /git version \d+/);
  const detectedPath = page.getByTestId("vc-detected-path");
  assert.ok(isAbsolute((await detectedPath.textContent()) ?? ""));
  assert.match(await detectedPath.locator("..").innerText(), /^(路径：|Path:)/);
  await panel
    .getByRole("button", { name: /^(添加账号 GitHub|Add Account GitHub)$/ })
    .evaluate((button) => button.click());
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.doesNotMatch(await dialog.innerText(), /建议权限|Recommended scopes|tokenHint\.github/);
  assert.equal(
    await dialog.getByRole("button", { name: /^(生成令牌|Generate Token)$/ }).count(),
    1,
  );
  assert.equal(await dialog.locator("#vc-account-secret").inputValue(), "");
  assert.equal(await dialog.locator("#vc-account-secret").getAttribute("type"), "password");
  await dialog
    .getByRole("button", { name: /^(取消|Cancel)$/ })
    .evaluate((button) => button.click());
  await dialog.waitFor({ state: "detached" });
  if (process.env.ZCODE_E2E_SCREENSHOT)
    await page.screenshot({ path: process.env.ZCODE_E2E_SCREENSHOT });
  process.stdout.write(
    "PASS: actual Desktop Host Git detection, settings entry, four account groups and cancelled masked credential dialog.\n",
  );
} finally {
  await browser.close();
}
