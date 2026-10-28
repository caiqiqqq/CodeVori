// Real browser + real LAN gateway; synthetic static page, no user sessions or Host RPC.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createDesktopLanGateway } from "../../server/src/desktopLanGateway.ts";

const root = await mkdtemp(join(tmpdir(), "zcode-lan-pairing-"));
const token = "synthetic-persistent-lan-token-minimum-32";
const replacement = "synthetic-replacement-lan-token-minimum-32";
const storageKey = "zcode.desktopLan.pairing.v1";
let gateway, otherGateway, browser;
const start = (token, port) =>
  createDesktopLanGateway({
    host: "127.0.0.1",
    port,
    token,
    staticRoot: root,
    allowedHosts: ["127.0.0.1", "localhost"],
    openAttachment() {
      throw new Error("Pairing tests must not open a Host");
    },
  });
try {
  await writeFile(join(root, "index.html"), "<!doctype html><h1>Paired desktop</h1>");
  gateway = await start(token);
  const port = gateway.port;
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page = await context.newPage();
  const errors = [];
  const trackErrors = () => page.on("pageerror", (error) => errors.push(error.message));
  trackErrors();
  await page.goto(`${origin}/?token=${token}`);
  await page.getByRole("heading", { name: "Paired desktop" }).waitFor();
  assert.equal(page.url(), origin + "/");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), token);
  assert.equal((await context.cookies(origin))[0].expires, -1, "No fixed cookie expiration");
  // Moving the browser clock beyond the old deadline must not require pairing.
  await page.clock.install();
  await page.clock.setFixedTime(new Date(Date.now() + 9 * 60 * 60 * 1000));
  await page.reload();
  await page.getByRole("heading", { name: "Paired desktop" }).waitFor();
  // A new browser session retains only origin storage, without session cookies.
  const state = await context.storageState();
  state.cookies = [];
  await context.close();
  await gateway.close();
  gateway = await start(token, port);
  context = await browser.newContext({ storageState: state });
  page = await context.newPage();
  trackErrors();
  await page.goto(origin);
  await page.getByRole("heading", { name: "Paired desktop" }).waitFor();
  // Cookie scope excludes ports, so the gateway must also bind authorization to origin.
  otherGateway = await start(token);
  const otherOrigin = `http://127.0.0.1:${otherGateway.port}`;
  assert.equal((await context.request.get(otherOrigin + "/api/desktop-window")).status(), 401);
  await page.goto(otherOrigin);
  await page.getByRole("button", { name: "Connect", exact: true }).waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null);
  await page.goto(`http://localhost:${port}`);
  await page.getByRole("button", { name: "Connect", exact: true }).waitFor();
  // Replacing the fixed Token invalidates both old cookies and saved credentials.
  await gateway.close();
  gateway = await start(replacement, port);
  assert.equal((await context.request.get(origin + "/api/desktop-window")).status(), 401);
  let restores = 0;
  page.on("request", (request) => {
    if (request.url() === origin + "/pair" && request.method() === "POST") restores++;
  });
  await page.goto(origin);
  await page.waitForFunction((key) => localStorage.getItem(key) === null, storageKey);
  await page.getByLabel("Access token").fill(replacement);
  assert.equal(restores, 1, "Invalid saved credentials are tried once");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("heading", { name: "Paired desktop" }).waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), replacement);
  const savedPairing = await context.storageState();
  savedPairing.cookies = [];
  // A failed network request keeps the saved credential and does not spin in redirects.
  const offline = await browser.newContext({ storageState: savedPairing });
  const offlinePage = await offline.newPage();
  let offlineAttempts = 0;
  const failed = new Promise((resolve) => offlinePage.once("requestfailed", resolve));
  await offline.route(origin + "/pair", (route) => {
    offlineAttempts++;
    return route.abort();
  });
  await offlinePage.goto(origin);
  await failed;
  await offlinePage.getByRole("button", { name: "Connect", exact: true }).waitFor();
  assert.equal(offlineAttempts, 1);
  assert.equal(
    await offlinePage.evaluate((key) => localStorage.getItem(key), storageKey),
    replacement,
  );
  await offline.close();
  // If the browser refuses cookies, a saved Token must not cause a navigation loop.
  const blocked = await browser.newContext({ storageState: savedPairing });
  const blockedPage = await blocked.newPage();
  let blockedAttempts = 0;
  await blocked.route(origin + "/pair", async (route) => {
    if (route.request().method() === "POST") {
      blockedAttempts++;
      // Simulate an accepted pairing response whose Set-Cookie the browser discards.
      await route.fulfill({ status: 303, headers: { location: "/pair" }, body: "" });
    } else await route.continue();
  });
  await blockedPage.goto(origin);
  await blockedPage.getByText("Unable to authorize this browser.", { exact: true }).waitFor();
  await blockedPage.getByRole("button", { name: "Connect", exact: true }).waitFor();
  assert.equal(blockedAttempts, 1);
  assert.equal(
    await blockedPage.evaluate((key) => localStorage.getItem(key), storageKey),
    replacement,
  );
  await blocked.close();
  // No storage support must not break manual pairing or the current browser session.
  const restricted = await browser.newContext();
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
  });
  const restrictedPage = await restricted.newPage();
  restrictedPage.on("pageerror", (error) => errors.push(error.message));
  await restrictedPage.goto(`${origin}/?token=${replacement}`);
  await restrictedPage.getByRole("heading", { name: "Paired desktop" }).waitFor();
  await restricted.close();
  // Token contents must stay data even when they contain HTML script delimiters.
  const unusualToken = "synthetic-32-characters-</script><script>window.tokenEscaped=true</script>";
  await otherGateway.close();
  otherGateway = await start(unusualToken);
  await page.goto(
    `http://127.0.0.1:${otherGateway.port}/?token=${encodeURIComponent(unusualToken)}`,
  );
  await page.getByRole("heading", { name: "Paired desktop" }).waitFor();
  assert.equal(await page.evaluate(() => window.tokenEscaped), undefined);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), unusualToken);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: persistent LAN pairing, beyond 8h, browser/gateway restart, origin isolation, Token replacement, manual pairing and disabled storage.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([gateway?.close(), otherGateway?.close()]);
  await rm(root, { recursive: true, force: true });
}
