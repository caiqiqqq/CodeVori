// Focused Agent Board status-library flow; synthetic Host, local preference persistence.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
import { exerciseAgentBoardWorkflow } from "./agentBoardWorkflowScenario.mjs";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const renderer = join(desktop, "src/renderer");
const name = `__agent-board-status-library-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-agent-board-status-library-"));
let browser, server;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(moduleFile, agentBoardFixture);
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: renderer,
    server: { host: "127.0.0.1", port: 19760, strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, locale: "zh-CN" });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("board-status-library-initialized")) {
      localStorage.clear();
      sessionStorage.setItem("board-status-library-initialized", "yes");
    }
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await exerciseAgentBoardWorkflow(page);
  assert.deepEqual(errors, []);
  console.log("PASS: Agent Board grouped status library and persistence.");
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(artifacts, { recursive: true, force: true }),
  ]);
}
