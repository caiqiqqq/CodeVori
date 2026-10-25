import assert from "node:assert/strict";

export async function verifyRememberedManagementKey({ page, panel, ready, keyInput }) {
  assert.match(await panel.textContent(), /已保存当前账号的管理密钥|Management key saved/);
  await page.evaluate(() => window.__devices.remount());
  await ready();
  assert.equal(await keyInput.inputValue(), "");
  assert.match(await panel.textContent(), /重启后自动恢复|restored after restart/);
  assert.ok(!(await panel.textContent()).includes("synthetic-session-key"));
  await keyInput.fill("unsaved-account-draft");
  await page.evaluate(() => {
    window.__devices.snapshot.loginName = "other@example.test";
    window.__devices.snapshot.managementConfigured = false;
  });
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="device-bridge-management-key"]')?.value === "",
  );
  assert.equal(await panel.getByTestId("device-bridge-remove-windows").isDisabled(), true);
  await page.evaluate(() => {
    window.__devices.snapshot.loginName = "synthetic@example.test";
    window.__devices.snapshot.managementConfigured = true;
    window.__devices.snapshot.managementStorageError = true;
  });
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
  assert.match(await panel.textContent(), /无法安全保存或读取|could not be saved or read securely/);
  await page.evaluate(() => {
    delete window.__devices.snapshot.managementStorageError;
  });
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
}
