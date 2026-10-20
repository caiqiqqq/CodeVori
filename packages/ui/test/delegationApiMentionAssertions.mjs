import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertApiDelegationMentions(page, main, shots, width) {
  for (const kind of ["acp", "api"]) {
    await main.fill("@model");
    const apiOption = page
      .locator('[data-trigger="@"] [data-section-id="delegation"][role="option"]')
      .filter({ hasText: "测试 API" });
    await apiOption.waitFor();
    const logo = apiOption.locator(
      '[data-task-agent-icon="api"][data-task-provider-id="api-provider"] img',
    );
    await logo.waitFor();
    const otherLogo = page
      .locator('[data-trigger="@"] [data-section-id="delegation"][role="option"]')
      .filter({ hasText: "第二 API" })
      .locator('[data-task-agent-icon="api"][data-task-provider-id="second-provider"] img');
    await otherLogo.waitFor();
    assert.notEqual(await logo.getAttribute("src"), await otherLogo.getAttribute("src"));
    assert.deepEqual(
      await logo.evaluate((element) => {
        const { width, height } = element.getBoundingClientRect();
        return [width, height];
      }),
      [16, 16],
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-section-id="delegation"] img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: join(shots, `api-mention-${kind}-${width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page
        .locator('[data-trigger="@"] [data-section-id="delegation"][role="option"]')
        .filter({ hasText: "第二 API" })
        .count(),
      1,
    );
    const before = await page.evaluate(
      () => window.__delegation.calls.filter((c) => c.op === "delegate").length,
    );
    await apiOption.click();
    assert.ok((await main.innerText()).includes("model/中文 v2"));
    const chip = main.locator('[data-mention-category="subagents"]');
    const label = await chip.innerText();
    const chipColor = await chip.evaluate((element) => getComputedStyle(element).color);
    assert.equal(await page.evaluate(() => window.__delegation.kind), kind);
    assert.equal(
      await page.evaluate(
        () => window.__delegation.calls.filter((c) => c.op === "delegate").length,
      ),
      before,
      "API mention selection does not create a task",
    );
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (count) => window.__delegation.sent.length === count,
      kind === "acp" ? 2 : 3,
    );
    const sent = await page.evaluate(() => window.__delegation.sent.at(-1));
    const sentChip = page.getByTestId("sent-user-message").locator("span").first();
    assert.equal(await sentChip.innerText(), label);
    assert.equal(await sentChip.locator("svg.lucide-bot").count(), 1);
    assert.equal(await sentChip.evaluate((element) => getComputedStyle(element).color), chipColor);
    assert.match(
      sent,
      /\[@model\/中文 v2.*测试 API.*\]\(delegation:\/\/api\.[0-9a-f]+\.[0-9a-f]+\)/,
    );
    await page.evaluate(() => window.__delegation.switchKind());
  }
}
