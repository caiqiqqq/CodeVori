// Driven by TestLocalStatusBrowserForms against the actual Go HTTP handler and a fake network.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const address = process.env.CODEVORI_STATUS_TEST_URL;
assert.ok(address, "Run through CODEVORI_NODE_BROWSER_TEST=1 go test");
const origin = new URL(address).origin;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let referer;
const external = createServer((request, response) => {
  referer = request.headers.referer;
  response.end("External navigation probe");
});
try {
  await new Promise((resolve) => external.listen(0, "127.0.0.1", resolve));
  await page.goto(address);
  const submit = async (label, action, status, scope = page) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(`/${action}`),
    );
    await scope.getByRole("button", { name: label, exact: true }).click();
    const response = await responsePromise;
    const headers = await response.request().allHeaders();
    // 只报告测试请求的 Origin/状态，不将私有能力路径写入输出。
    console.log(JSON.stringify({ action, origin: headers.origin, status: response.status() }));
    assert.equal(response.status(), status);
    assert.equal(headers.origin, origin);
    if (status === 303) await page.waitForURL(address);
  };
  await page.getByText("等待登录", { exact: true }).waitFor();
  await submit("开始 Tailscale 登录", "login", 303);
  await page.getByRole("heading", { name: "网络已连接", exact: true }).waitFor();
  const controller = page.getByRole("listitem").filter({ hasText: "Browser controller" });
  await submit("允许控制", "authorize", 303, controller);
  await controller.getByText("已授权", { exact: true }).waitFor();
  await controller.getByText("在线", { exact: true }).waitFor();
  const output = process.env.CODEVORI_STATUS_TEST_OUTPUT;
  if (output) await mkdir(output, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const width of [320, 390, 933, 1280]) {
      await page.setViewportSize({ width, height: 990 });
      await page.getByRole("heading", { name: "CodeVori Node", exact: true }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${theme} ${width}: horizontal overflow`,
      );
      for (const label of ["停止连接", "检查更新", "卸载"]) {
        assert.ok(await page.getByRole("button", { name: label, exact: true }).isVisible());
      }
      assert.equal(
        await page
          .getByRole("button", { name: "停止连接", exact: true })
          .evaluate((button) => getComputedStyle(button).backgroundColor),
        theme === "dark" ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
        "buttons follow the current theme",
      );
      if (output && [390, 933].includes(width)) {
        await page.screenshot({
          path: join(output, `node-${theme}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  }
  await page.setViewportSize({ width: 933, height: 990 });
  await page.emulateMedia({ colorScheme: "light" });
  const revoke = controller.getByRole("button", { name: "撤销控制", exact: true });
  await revoke.focus();
  assert.ok(await revoke.evaluate((button) => button === document.activeElement));
  await submit("撤销控制", "authorize", 303, controller);
  await controller.getByText("未授权", { exact: true }).waitFor();

  // Cross-origin form submission retains the known capability but must remain forbidden.
  const foreign = `http://127.0.0.1:${external.address().port}`;
  await page.goto(foreign);
  await page.evaluate((target) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = target + "/login";
    document.body.append(form);
    form.submit();
  }, address);
  await page.getByText("forbidden", { exact: true }).waitFor();
  await page.goto(address);

  // The private status URL must not appear in an external request's Referer.
  await page.evaluate((target) => {
    const link = document.createElement("a");
    link.href = target;
    link.textContent = "External navigation probe";
    document.body.append(link);
  }, foreign);
  await page.getByRole("link", { name: "External navigation probe", exact: true }).click();
  await page.waitForURL(foreign + "/");
  assert.equal(referer, undefined);
  await page.goto(address);
  await submit("停止连接", "stop", 202);
  console.log("Browser login, grant, revoke, stop and referrer isolation passed");
} finally {
  await browser.close();
  await new Promise((resolve) => external.close(resolve));
}
