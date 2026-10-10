// ZCODE_E2E_BASE_URL=http://127.0.0.1:5193 node packages/ui/test/conversationVisualizations.e2e.mjs
// Real shared rendering with synthetic file services; no model requests or user data.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__visualizations-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-visualizations-e2e-"));
console.log(`Screenshots: ${artifacts}`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(moduleFile, `import '../../../ui/test/conversationVisualizations.fixture.tsx';`);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375])
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      let escapedRequests = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url() === "https://example.com/blocked") escapedRequests++;
      });
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193"}/${name}.html`);
      await page.locator("[data-ready]").waitFor();
      await page.evaluate((theme) => window.__visualizations.theme(theme), theme);
      for (const kind of ["api", "acp"]) {
        await page.evaluate(
          (kind) => window.__visualizations.configure({ kind, session: kind }),
          kind,
        );
        const frame = page.frameLocator('[data-testid="conversation-visualization"] iframe');
        await frame.locator("#increment").click();
        await frame.locator("#increment").filter({ hasText: "Clicked 1" }).waitFor();
        assert.equal(await frame.locator("#isolation").textContent(), "Isolated");
        assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
        await page.waitForFunction(
          () => document.querySelector("iframe").getBoundingClientRect().height < 250,
        );
        assert.equal(await page.locator("strong").filter({ hasText: "Before preview" }).count(), 1);
        assert.ok((await page.locator("[data-ready]").textContent()).includes("After preview"));
        assert.ok(!(await page.locator("[data-ready]").textContent()).includes("visualize"));
        assert.equal(
          await frame.locator("html").evaluate((node) => getComputedStyle(node).colorScheme),
          theme === "zai-dark" ? "dark" : "light",
        );
        const geometry = await page.locator("iframe").evaluate((node) => ({
          width: node.getBoundingClientRect().width,
          right: node.getBoundingClientRect().right,
          height: node.getBoundingClientRect().height,
        }));
        assert.ok(geometry.width > 0 && geometry.right <= width + 1);
        const height = await page
          .locator("iframe")
          .evaluate((node) => node.getBoundingClientRect().height);
        await page.evaluate(() =>
          window.postMessage({ type: "zcode-visualization-height", height: 1399 }, "*"),
        );
        assert.equal(
          await page.locator("iframe").evaluate((node) => node.getBoundingClientRect().height),
          height,
        );
        await page.screenshot({
          path: join(artifacts, `${width}-${theme}-${kind}.png`),
          fullPage: true,
        });
      }
      assert.equal(escapedRequests, 0);
      assert.equal(await page.locator("body").getAttribute("data-escaped"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193"}/${name}.html`);
  await page.locator("iframe").waitFor();
  const configure = (next) =>
    page.evaluate((next) => window.__visualizations.configure(next), next);
  const marker = await page.evaluate(() => window.__visualizations.marker);
  await configure({ kind: "direct", streaming: true, text: marker.slice(0, -1) });
  await page.locator("iframe").waitFor({ state: "detached" });
  assert.ok(!(await page.locator("[data-ready]").textContent()).includes("visualize"));
  await configure({ text: marker });
  await page.frameLocator("iframe").locator("#preview").waitFor();
  await configure({ streaming: false, text: "```text\n" + marker + "\n```" });
  await page.locator("iframe").waitFor({ state: "detached" });
  await page.screenshot({ path: join(artifacts, "code-example.png") });
  await page.locator("[data-line]").filter({ hasText: "visualize" }).waitFor();

  await page.evaluate(() => {
    window.__visualizations.missing(true);
  });
  await configure({ text: marker, session: "missing" });
  await page.getByRole("button", { name: "重试", exact: true }).waitFor();
  await page.evaluate(() => window.__visualizations.missing(false));
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.frameLocator("iframe").locator("h2").filter({ hasText: "Local" }).waitFor();

  await page.evaluate(() => window.__visualizations.slow(true));
  await configure({ identity: "fixture-remote-a", remoteSessionId: "remote-a", session: "remote" });
  await page.waitForFunction(() => window.__visualizations.calls.includes("Remote A"));
  await configure({ identity: "fixture-remote-b", remoteSessionId: "remote-b" });
  await page.frameLocator("iframe").locator("h2").filter({ hasText: "Remote B" }).waitFor();
  await page.evaluate(() => window.__visualizations.release());
  await page.frameLocator("iframe").locator("h2").filter({ hasText: "Remote B" }).waitFor();
  const localReads = await page.evaluate(
    () => window.__visualizations.calls.filter((call) => call === "Local").length,
  );
  await page.evaluate(() => window.__visualizations.disconnect());
  await page.locator("iframe").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () => window.__visualizations.calls.filter((call) => call === "Local").length,
    ),
    localReads,
  );
  await page.evaluate(() => window.__visualizations.reconnect());
  await page.frameLocator("iframe").locator("h2").filter({ hasText: "Remote B" }).waitFor();
  if (process.env.ZCODE_E2E_VISUALIZATION_HTML) {
    const fragment = await readFile(process.env.ZCODE_E2E_VISUALIZATION_HTML, "utf8");
    await page.evaluate((fragment) => window.__visualizations.content(fragment), fragment);
    await configure({
      identity: "",
      remoteSessionId: "",
      kind: "acp",
      session: "reported-fragment",
    });
    const frame = page.frameLocator("iframe");
    await frame.locator('[data-action="next"]').click();
    await frame.locator("[data-progress]").filter({ hasText: "第 2 步" }).waitFor();
    await page.screenshot({ path: join(artifacts, "reported-fragment.png"), fullPage: true });
  }
  await page.close();
  console.log(
    `PASS: API/ACP parity, 8 desktop/mobile theme cases, streaming, retry, isolated remote reads. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
