// Real SettingsPage, synthetic native platform. No tailnet enrollment or real user credentials.
import assert from "node:assert/strict";
import { verifyRememberedManagementKey } from "./deviceBridgeManagement.scenarios.mjs";
import { verifyDevicePeerStatus } from "./deviceBridgePeerStatus.scenarios.mjs";
import { verifyInspectionTableScroll } from "./deviceInspectionScroll.scenarios.mjs";
import { writeDeviceBridgeSettingsFixture } from "./deviceBridgeSettings.fixture.mjs";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__device-bridge-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-device-settings-"));
let server, browser, page;
const errors = [];
try {
  await writeDeviceBridgeSettingsFixture(html, moduleFile, name);
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const navigation = page.getByRole("button", { name: /^(设备与连接|Devices & connections)$/ });
  const general = page.getByRole("button", { name: /^(常规|General)$/ });
  const panel = page.getByTestId("device-bridge-settings");
  const ready = async () => {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="device-bridge-settings"]')
          ?.getAttribute("aria-busy") === "false",
    );
  };
  await navigation.waitFor();
  assert.equal(await panel.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__devices.calls), []);
  await navigation.click();
  await ready();
  await panel.getByTestId("device-bridge-start").waitFor({ state: "visible" });
  assert.equal(await panel.getByTestId("device-node-create").count(), 0);
  assert.equal(await panel.getByTestId("device-node-link").count(), 0);
  assert.equal(await panel.getByTestId("device-bridge-peer-windows").count(), 0);
  await panel.getByTestId("device-node-download").click();
  await ready();
  assert.deepEqual(await page.evaluate(() => window.__devices.calls.at(-1)), {
    action: "download-node",
    platform: "win32-x64",
  });
  assert.deepEqual(await page.evaluate(() => window.__devices.externalUrls), [
    "https://aimodetest.cn/codevori-node/clients/current/CodeVoriNode-win32-x64.exe",
  ]);
  await page.evaluate(() => {
    window.__devices.externalUrls = [];
  });
  const settingsUrl = page.url();
  await panel.getByTestId("device-bridge-management-get-key").click();
  assert.deepEqual(await page.evaluate(() => window.__devices.externalUrls), [
    "https://console.tailscale.com/admin/settings/keys",
  ]);
  assert.equal(page.url(), settingsUrl);
  assert.equal(await navigation.getAttribute("aria-current"), "page");
  const failures = [
    ["device_bridge_component_missing", "未找到连接组件", "was not found"],
    ["device_bridge_component_not_executable", "没有执行权限", "cannot be executed"],
    ["device_bridge_start_failed", "启动失败", "could not start"],
    ["device_bridge_process_closed", "意外退出", "exited unexpectedly"],
    ["synthetic-private-token-and-auth-url", "连接操作未完成", "operation did not complete"],
  ];
  for (const [locale, language] of [
    ["zh-CN", 1],
    ["en-US", 2],
  ]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    for (const failure of failures) {
      await page.evaluate((code) => {
        window.__devices.startError = code;
      }, failure[0]);
      await panel.getByTestId("device-bridge-start").click();
      await ready();
      const alert = panel.getByRole("alert");
      assert.ok((await alert.textContent()).includes(failure[language]));
      assert.ok(!(await alert.textContent()).includes("synthetic-private"));
      await panel.getByTestId("device-bridge-refresh").click();
      await ready();
      assert.ok((await alert.textContent()).includes(failure[language]));
      await general.click();
      await navigation.click();
      await ready();
      assert.ok((await panel.getByRole("alert").textContent()).includes(failure[language]));
      await page.evaluate(() => {
        window.__devices.startError = null;
      });
      await panel.getByTestId("device-bridge-select-component").click();
      await ready();
      assert.equal(await panel.getByRole("alert").count(), 0);
    }
  }
  // 成功重试也必须清除 Main 的错误投影和 hook 的暂态错误。
  await page.evaluate(() => {
    window.__devices.startError = "device_bridge_component_missing";
  });
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  await page.evaluate(() => {
    window.__devices.startError = null;
  });
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  assert.equal(await panel.getByRole("alert").count(), 0);
  await panel.getByTestId("device-bridge-stop").click();
  await ready();
  await panel.getByTestId("device-bridge-select-component").click();
  await ready();
  assert.ok((await panel.textContent()).includes("/synthetic/replacement-device-bridge"));
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  await panel.getByTestId("device-bridge-login").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.calls.at(-1).action), "open-login");
  assert.equal(await panel.getByTestId("device-bridge-select-component").isDisabled(), true);
  await page.evaluate(() => window.__devices.authorize());
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
  assert.equal(
    await panel.getByTestId("device-bridge-account").textContent(),
    "synthetic@example.test",
  );
  assert.equal(await panel.getByTestId("device-bridge-connect-offline").isDisabled(), true);
  assert.match(await panel.getByTestId("device-bridge-node-id").textContent(), /mac/);
  assert.equal(await panel.getByTestId("device-bridge-remove-windows").isDisabled(), true);
  await verifyDevicePeerStatus({ page, panel, ready });
  const keyInput = panel.getByTestId("device-bridge-management-key");
  assert.equal(await keyInput.getAttribute("type"), "password");
  await keyInput.fill("synthetic-session-key");
  await panel.getByTestId("device-bridge-management-get-key").click();
  assert.equal(await keyInput.inputValue(), "synthetic-session-key");
  assert.deepEqual(await page.evaluate(() => window.__devices.externalUrls), [
    "https://console.tailscale.com/admin/settings/keys",
    "https://console.tailscale.com/admin/settings/keys",
  ]);
  await panel.getByTestId("device-bridge-management-save").click();
  await ready();
  assert.equal(await keyInput.inputValue(), "");
  await verifyRememberedManagementKey({ page, panel, ready, keyInput });
  await panel.getByTestId("device-bridge-remove-offline").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok((await dialog.textContent()).includes("Offline workstation"));
  assert.ok((await dialog.textContent()).includes("offline"));
  await dialog.getByRole("button", { name: /Cancel|取消/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__devices.calls.some((c) => c.action === "remove")),
    false,
  );
  await panel.getByTestId("device-bridge-remove-offline").click();
  await dialog.getByRole("button", { name: /Remove from network|从网络移除/ }).click();
  await ready();
  await panel.getByTestId("device-bridge-peer-offline").waitFor({ state: "detached" });
  await panel.getByTestId("device-bridge-management-clear").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-remove-windows").isDisabled(), true);
  await keyInput.fill("synthetic-session-key");
  await panel.getByTestId("device-bridge-management-save").click();
  await ready();
  await page.evaluate(() => {
    window.__devices.fail = true;
    window.__devices.failCode = "device_bridge_management_forbidden";
  });
  await panel.getByTestId("device-bridge-remove-windows").click();
  await dialog.getByRole("button", { name: /Remove from network|从网络移除/ }).click();
  await ready();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByTestId("device-bridge-peer-windows").count(), 1);
  assert.match(await panel.getByRole("alert").textContent(), /cannot delete|没有删除/);
  await page.evaluate(() => {
    delete window.__devices.failCode;
  });
  const connect = panel.getByTestId("device-bridge-connect-windows");
  await page.evaluate(() => {
    window.__devices.fail = true;
  });
  await connect.click();
  await ready();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByTestId("device-bridge-check-windows").count(), 0);
  await page.evaluate(() => {
    window.__devices.hold = true;
  });
  await connect.click();
  await page.waitForFunction(() => Boolean(window.__devices.release));
  assert.equal(await connect.isDisabled(), true);
  assert.equal(await panel.getByTestId("device-bridge-authorize-windows").isDisabled(), true);
  await page.evaluate(() => window.__devices.release());
  await ready();
  assert.equal(await panel.getByRole("alert").count(), 0);
  assert.ok((await panel.getByTestId("device-bridge-check-result").textContent()).includes("7"));
  const details = page.getByTestId("device-inspection");
  const openDetails = async () => {
    await panel.getByTestId("device-bridge-inspect-windows").click();
    await details.getByTestId("device-inspection-system").waitFor();
  };
  const closeDetails = async () => {
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await details.waitFor({ state: "detached" });
  };
  await openDetails();
  assert.match(await details.textContent(), /Synthetic CPU/);
  assert.match(await details.getByTestId("device-inspection-processes").textContent(), /example-/);
  assert.equal(await details.getByTestId("device-inspection-screen").count(), 0);
  assert.equal(
    await page.evaluate(() => window.__devices.inspections.some((r) => r.kind === "screen")),
    false,
  );
  await details.getByTestId("device-inspection-screen-refresh").click();
  await details.getByTestId("device-inspection-screen").waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="device-inspection-screen"]')?.naturalWidth === 1,
  );
  await page.evaluate(() => {
    window.__devices.inspectionError = true;
  });
  await details.getByTestId("device-inspection-refresh").click();
  await details.getByTestId("device-inspection-error").waitFor();
  assert.equal(await details.getByTestId("device-inspection-system").count(), 0);
  assert.ok(!(await details.textContent()).includes("synthetic-private"));
  await details.getByTestId("device-inspection-screen-refresh").click();
  await details.getByTestId("device-inspection-screen").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.__devices.inspectionError = false;
  });
  await details.getByTestId("device-inspection-refresh").click();
  await details.getByTestId("device-inspection-system").waitFor();
  await closeDetails();
  // 关闭后迟到的观察结果不能恢复已关闭详情或泄漏至下一次打开。
  await page.evaluate(() => {
    window.__devices.holdInspection = true;
  });
  await panel.getByTestId("device-bridge-inspect-windows").click();
  await page.waitForFunction(() => Boolean(window.__devices.releaseInspection));
  await closeDetails();
  await page.evaluate(() => {
    window.__devices.releaseInspection();
    delete window.__devices.releaseInspection;
  });
  assert.equal(await details.count(), 0);
  await openDetails();
  assert.equal(await details.getByTestId("device-inspection-screen").count(), 0);
  // 网络投影变为断开时自动关闭详情；重新连接后需要用户重新打开。
  await page.evaluate(() => {
    const p = window.__devices.snapshot.peers[0];
    p.connected = false;
    delete p.checkedAt;
    delete p.toolCount;
  });
  await details.waitFor({ state: "detached" });
  await panel.getByTestId("device-bridge-connect-windows").click();
  await ready();
  assert.equal(await details.count(), 0);
  await panel.getByTestId("device-bridge-authorize-windows").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].allowed), true);
  await panel.getByTestId("device-bridge-authorize-windows").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].allowed), false);
  await general.click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].connected), true);
  await navigation.click();
  await ready();
  await panel.getByTestId("device-bridge-check-windows").click();
  await ready();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__devices.setTheme(theme), theme);
      for (const width of [1280, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "Settings must fit viewport",
        );
        const bounds = await panel.boundingBox();
        for (const button of await panel.getByRole("button").all()) {
          const box = await button.boundingBox();
          assert.ok(
            box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1,
            `${locale}/${theme}/${width}: ${await button.textContent()} must stay inside panel`,
          );
        }
        await openDetails();
        assert.ok(
          await details.evaluate((el) => el.scrollWidth <= el.clientWidth),
          "Computer details must fit the viewport",
        );
        await verifyInspectionTableScroll({
          page,
          details,
          screenshotPath: join(artifacts, `process-scroll-${locale}-${theme}-${width}.png`),
        });
        await details.getByTestId("device-inspection-screen-refresh").click();
        await details.getByTestId("device-inspection-screen").waitFor();
        await page.screenshot({
          path: join(artifacts, `inspection-${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
        await closeDetails();
        await panel.getByTestId("device-bridge-management-key").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(artifacts, `${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    await page.setViewportSize({ width: 320, height: 900 });
    await panel.getByTestId("device-bridge-remove-windows").click();
    await dialog.waitFor();
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "Long device name must fit confirmation",
    );
    await page.screenshot({
      path: join(artifacts, `${locale}-removal-confirmation-320.png`),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: /Cancel|取消/ }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  await panel.getByTestId("device-bridge-connect-windows").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-check-result").count(), 0);
  await page.evaluate(() => window.__devices.remount());
  await ready();
  assert.equal(await navigation.getAttribute("aria-current"), "page");
  const loginCount = await page.evaluate(
    () => window.__devices.calls.filter((command) => command.action === "open-login").length,
  );
  await panel.getByTestId("device-bridge-stop").click();
  await ready();
  assert.match(await panel.textContent(), /已有登录状态会保留|Existing sign-in is kept/);
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  assert.equal(
    await panel.getByTestId("device-bridge-account").textContent(),
    "synthetic@example.test",
  );
  assert.equal(await panel.getByTestId("device-bridge-login").count(), 0);
  assert.equal(
    await page.evaluate(
      () => window.__devices.calls.filter((command) => command.action === "open-login").length,
    ),
    loginCount,
  );
  await panel.getByTestId("device-bridge-logout").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-account").count(), 0);
  await panel.getByTestId("device-bridge-start").waitFor();
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  await panel.getByTestId("device-bridge-login").waitFor();
  await page.evaluate(() => window.__devices.setMode("web"));
  await panel.waitFor({ state: "detached" });
  assert.equal(await navigation.count(), 0);
  assert.equal(await general.getAttribute("aria-current"), "page");
  await page.evaluate(() => window.__devices.intent("devices"));
  assert.equal(await general.getAttribute("aria-current"), "page");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real SettingsPage; generic client download, visible Tailscale network flow, member discovery, CPU/memory/process details, opaque sticky process headings during vertical/horizontal scrolling, manual PNG screen, safe failure clearing, close/disconnect stale reads, responsive details; specific safe startup errors, refresh/remount/retry recovery, component selection, login, health failure/retry, pending controls, management key lifecycle, cancel/confirm removal and failure, explicit grant/revoke, page lifetime, stop/reconnect without signing in again, logout requires sign-in, capability gating, zh/en, light/dark, 320/375/1280px. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
