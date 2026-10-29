// Real board components/hooks with synthetic Host services and chat transport.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
import { exerciseAgentBoardWaiting } from "./agentBoardWaitingScenario.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-running-${process.pid}`;
const html = join(renderer, name + ".html"),
  moduleFile = join(renderer, name + ".tsx");
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186";
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
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
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
    console.error(error);
  });
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(props){window.__pane=props;return window.__React.createElement('div',{'data-testid':'real-pane-contract','data-native-id':props.sessionId??'','data-acp-id':props.acpBoundSessionId??'','data-identity':props.workspaceIdentity??'','data-remote':props.remoteSessionId??'','data-readonly':String(props.readOnly)},'Synthetic chat transport');}`,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function V4PaneConversationProvider({scope,children}){window.__paneScope=scope;return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error('Synthetic pane boundary only')}`,
    }),
  );
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("board-fixture-initialized")) {
      localStorage.clear();
      // 旧收藏视图升级后回到全部，原收藏成员仍应显示。
      localStorage.setItem(
        "zcode-agent-board:v1",
        JSON.stringify({
          project: null,
          pinnedProjects: null,
          view: "starred",
          group: "status",
          agent: "all",
          search: "",
        }),
      );
      sessionStorage.setItem("board-fixture-initialized", "yes");
    }
    localStorage.setItem("zcode-locale-preference", "zh-CN");
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.className = "theme-zai-light";
    });
  });
  await page.goto(origin + "/" + name + ".html");
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 25);
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "staging-review",
      title: "Seed review",
      prompt: "Seed",
      runText: "Seed",
      session: { kind: "api", id: "seed-session" },
      status: "review",
      archived: false,
      stopPending: false,
      runSeq: 1,
      createdAt: 100,
      updatedAt: 1000,
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "fixture-provider", modelId: "model" },
      },
    });
    f.notifyWork();
  });
  await exerciseAgentBoardWaiting(page, artifacts);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Native/ACP/WorkTask animated running indicators and column header; waiting/queued/offline/completion transitions; reduced motion; desktop/mobile themes.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
