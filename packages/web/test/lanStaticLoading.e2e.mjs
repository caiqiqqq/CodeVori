// Production bundle through the real authenticated LAN gateway. Stop before Host RPC;
// only module evaluation and HTTP loading are measured, never user sessions or iPhone latency.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createDesktopLanGateway } from "../../server/src/desktopLanGateway.ts";

const root = resolve(import.meta.dirname, "../dist");
const token = "synthetic-lan-loading-test-token-minimum-32";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-lan-loading-"));
let browser;
const gateway = await createDesktopLanGateway({
  host: "127.0.0.1",
  token,
  staticRoot: root,
  allowedHosts: ["127.0.0.1"],
  openAttachment() {
    throw new Error("No Host attachment allowed");
  },
});
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (10 * 1024 * 1024) / 8,
    connectionType: "wifi",
  });
  // addInitScript does not disable the browser HTTP cache (Playwright route interception does).
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (input, init) =>
      String(input) === "/api/desktop-window"
        ? Promise.reject(new Error("Synthetic stop before Host connection"))
        : fetchOriginal(input, init);
  });
  const origin = `http://127.0.0.1:${gateway.port}`;
  const paired = await context.request.get(`${origin}/?token=${token}`, { maxRedirects: 0 });
  assert.equal(paired.status(), 303);
  const measurements = [];
  for (const phase of ["cold", "warm"]) {
    await page.goto(origin);
    await page
      .getByText("Synthetic stop before Host connection", { exact: true })
      .waitFor({ timeout: 60000 });
    const measurement = await page.evaluate(() => {
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/assets/"));
      return {
        resources: resources.length,
        transferredBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        encodedBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        decodedBytes: resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        cachedResources: resources.filter(
          (entry) => entry.transferSize === 0 && entry.decodedBodySize > 0,
        ).length,
        durationMs: Math.round(performance.now()),
      };
    });
    measurements.push({ phase, ...measurement });
    await page.screenshot({ path: join(artifacts, `${phase}.png`) });
  }
  const [cold, warm] = measurements;
  assert.ok(cold.resources < 100, `Entry resources should be consolidated: ${cold.resources}`);
  assert.ok(cold.encodedBytes < cold.decodedBytes * 0.45, "Cold assets must be compressed");
  assert.ok(
    warm.cachedResources >= warm.resources * 0.9,
    "Warm assets should use private browser cache",
  );
  assert.ok(
    warm.transferredBytes < cold.transferredBytes * 0.1,
    "Warm load should avoid retransmitting the app",
  );
  assert.deepEqual(errors, [], "Bundled modules must evaluate without initialization errors");
  await writeFile(join(artifacts, "measurements.json"), JSON.stringify(measurements, null, 2));
  process.stdout.write(
    `PASS: production module evaluation, gzip and private cold/warm loading (synthetic 10Mbps/20ms): ${JSON.stringify(measurements)}. Artifacts: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await gateway.close();
}
