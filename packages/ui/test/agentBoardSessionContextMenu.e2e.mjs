import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
import {
  exerciseAgentBoardSessionContextMenu,
  exerciseAgentBoardSessionMenuActions,
} from "./agentBoardSessionContextMenuScenario.mjs";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-context-menu-${process.pid}`;
const html = join(renderer, name + ".html");
const moduleFile = join(renderer, name + ".tsx");
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5174";
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
const screenshotPath = join(artifacts, "agent-board-session-context-menu.png");
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(moduleFile, agentBoardFixture);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(props){window.__pane=props;return window.__React.createElement('div',{'data-testid':'session-context-pane','data-acp-id':props.acpBoundSessionId??''},'Synthetic conversation')}`,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function V4PaneConversationProvider({children}){return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error('Synthetic pane boundary only')}`,
    }),
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.className = "theme-zai-light";
    });
  });
  await page.goto(`${origin}/${name}.html`);
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 25);
  await exerciseAgentBoardSessionContextMenu(page, screenshotPath);
  await exerciseAgentBoardSessionMenuActions(page);
  assert.equal(await page.getByRole("dialog").count(), 0, "right-click must not open details");
  console.log(
    `PASS: session card/detail menus, rename, unread, copy, stage, navigation and archive; screenshot: ${screenshotPath}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
