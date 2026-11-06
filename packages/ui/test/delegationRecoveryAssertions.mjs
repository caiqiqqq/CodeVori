export async function assertDelegationRecovery(page, panel, row) {
  await row.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="delegation-task"]')?.getAttribute("data-status") ===
      "running",
  );
  await row.getByRole("button", { name: "取消任务" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="delegation-task"]')?.getAttribute("data-status") ===
      "canceled",
  );
  await page.evaluate(() => window.__delegation.setStatus("interrupted"));
  await row.getByRole("button", { name: "恢复", exact: true }).click();
  await page.waitForFunction(() =>
    window.__delegation.calls.some(
      (call) => call.op === "resume" && call.kind === "acp" && call.sessionId === "acp-parent",
    ),
  );
  await page.evaluate(() => window.__delegation.addRunning());
  await panel.getByRole("button", { name: "取消全部", exact: true }).click();
  await page.waitForFunction(() =>
    window.__delegation.calls.some((call) => call.op === "cancel-all" && call.kind === "acp"),
  );
}

export async function assertApiChildNavigation(page, panel) {
  await panel
    .getByTestId("delegation-task")
    .first()
    .locator('[data-testid^="tool-summary-trigger-"]')
    .press("Enter");
  await page.waitForFunction(
    () =>
      window.__delegation.navigation?.kind === "api" &&
      window.__delegation.navigation?.taskId === "api-child",
  );
}
