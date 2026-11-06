import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertDelegationUnavailableViews(page, panel) {
  for (const view of ["draft", "readonly"]) {
    await page.evaluate((value) => window.__delegation.setView(value), view);
    await page.waitForFunction(() => !window.__delegation.available);
    await page.getByRole("button", { name: "添加上下文", exact: true }).click();
    await page.getByRole("option", { name: "上传主附件", exact: true }).waitFor();
    assert.equal(await page.getByRole("option", { name: "委派任务", exact: true }).count(), 0);
    assert.equal(await panel.count(), 0, `${view} has no delegation panel`);
    await page.keyboard.press("Escape");
    await page.locator('[data-trigger="+"]').waitFor({ state: "hidden" });
  }
}

export async function assertDelegationStatusPanel(page, shots, width) {
  await page.evaluate(() => {
    window.__delegation.clear();
    window.__delegation.addUnbound();
  });
  const summary = page.getByTestId("chat-summary-panel");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="chat-summary-panel"]')
        ?.getAttribute("data-running-agent-count") === "1",
  );
  await summary.getByRole("button").first().click();
  await summary.locator('[data-status-section-trigger="agent"]').click();
  await summary.locator("[data-running-delegation-id]").waitFor();
  assert.equal(await summary.locator("[data-delegation-session-trigger]").count(), 0);
  await page.evaluate(() => {
    window.__delegation.clear();
    window.__delegation.addRunning();
    window.__delegation.setNative(true);
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="chat-summary-panel"]')
        ?.getAttribute("data-running-agent-count") === "2",
  );
  const agentSection = summary.locator('[data-status-section-trigger="agent"]');
  if ((await agentSection.getAttribute("aria-expanded")) !== "true") await agentSection.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="chat-summary-panel"]')?.getBoundingClientRect().height >
      170,
  );
  assert.equal(await summary.locator("[data-running-delegation-id]").count(), 1);
  assert.equal(await summary.locator('li[data-child-session-id="native-child"]').count(), 1);
  await page.screenshot({
    path: join(shots, `delegation-status-api-${width}.png`),
    fullPage: true,
  });
  await summary.locator("[data-running-delegation-id] [data-delegation-session-trigger]").click();
  await page.waitForFunction(() => window.__delegation.navigation?.taskId === "api-child");
  await summary.locator("[data-running-delegation-id] [data-delegation-cancel]").click();
  await page.waitForFunction(() => window.__delegation.calls.some((call) => call.op === "cancel"));
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="chat-summary-panel"]')
        ?.getAttribute("data-running-agent-count") === "1",
  );
  await page.evaluate(() => {
    window.__delegation.setNative(false);
    window.__delegation.switchKind();
    window.__delegation.addRunning();
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="chat-summary-panel"]')
        ?.getAttribute("data-running-agent-count") === "1",
  );
  const agents = summary.locator('[data-status-section-trigger="agent"]');
  if ((await agents.getAttribute("aria-expanded")) !== "true") await agents.click();
  await summary.locator("[data-running-delegation-id]").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="chat-summary-panel"]')?.getBoundingClientRect().height >
      100,
  );
  assert.equal(await summary.locator("[data-running-delegation-id]").count(), 1);
  await page.screenshot({
    path: join(shots, `delegation-status-acp-${width}.png`),
    fullPage: true,
  });
  await summary.locator("[data-running-delegation-id] [data-delegation-session-trigger]").click();
  await page.waitForFunction(() => window.__delegation.navigation?.session?.id === "acp-child");
  await page.evaluate(() => window.__delegation.setStatus("completed"));
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-summary-panel"]'));
}
