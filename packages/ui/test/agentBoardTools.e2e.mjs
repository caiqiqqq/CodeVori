// Uses the ordinary useAppPanels and AnimatedSidePanePanel; only Host transport is synthetic.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardToolsFixture } from "./agentBoardToolsFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__board-tools-${process.pid}`;
const html = join(renderer, name + ".html"),
  moduleFile = join(renderer, name + ".tsx");
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(moduleFile, agentBoardToolsFixture);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/v4/SessionPane.tsx*", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(p){const R=window.__React;window.__pane=p;const [draft,setDraft]=R.useState('');return R.createElement('textarea',{'aria-label':'会话草稿',value:draft,onChange:e=>setDraft(e.target.value)});}`,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'export function V4PaneConversationProvider({children}){return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error("Synthetic transport boundary")}',
    }),
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  const open = async (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .getByRole("button")
      .first()
      .click();
  await open("Remote ACP 0");
  await page.getByRole("textbox", { name: "会话草稿" }).fill("保留草稿");
  assert.deepEqual(
    await page.evaluate(() =>
      [
        "onOpenBrowserUrl",
        "onOpenCodeViewer",
        "onOpenFileLink",
        "onOpenBackgroundBash",
        "onOpenSubagentSession",
        "onOpenSubagentDirectory",
        "onSyncSubagentSessionTabs",
        "onOpenSelectionSideChat",
        "onOpenPlanDetail",
        "onOpenWorkflowRun",
        "onOpenWorkflowArtifact",
        "onOpenWorkflowRunDirectory",
        "onOpenWorkflowActorSession",
        "onOpenWorkflowWorkspace",
      ].filter((key) => typeof window.__pane[key] !== "function"),
    ),
    [],
  );
  await page
    .getByTestId("agent-board-tools-toggle")
    .getByRole("button", { name: "展开侧边面板", exact: true })
    .click();
  const tools = page.locator("[data-workspace-side-frame]");
  for (const tool of ["review", "terminal", "browser"])
    await tools.locator(`[data-side-pane-open-tab-item="${tool}"]`).waitFor();
  await page.evaluate(() => {
    window.__frame = document.querySelector("[data-workspace-side-frame]");
  });
  await tools.locator('[data-side-pane-open-tab-item="review"]').click();
  await tools.locator("[data-side-pane-tab-id]").first().waitFor();
  assert.equal(await page.evaluate(() => window.__toolsTarget.workspaceIdentity), "remote:0");
  assert.equal(await page.evaluate(() => window.__toolsTarget.nativeSessionId), null);
  await page.evaluate(() =>
    window.__pane.onOpenCodeViewer({
      type: "text",
      title: "Shared file",
      content: "SELECT 42;",
      language: "sql",
    }),
  );
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).waitFor();
  assert.equal(await tools.locator("[data-side-pane-tab-id]").count(), 2);
  await page.evaluate(() => window.__panels.handleCloseAllSidePaneTabs());
  await page
    .getByTestId("agent-board-tools-toggle")
    .getByRole("button", { name: "展开侧边面板", exact: true })
    .click();
  await tools.locator('[data-side-pane-open-tab-item="browser"]').waitFor();
  await tools.locator('[data-side-pane-open-tab-item="browser"]').click();
  await page.waitForFunction(() =>
    window.__panels.sidePaneState?.tabs.some((t) => t.type === "browser"),
  );
  await page.evaluate(() => window.__panels.handleCloseAllSidePaneTabs());
  await page
    .getByTestId("agent-board-tools-toggle")
    .getByRole("button", { name: "展开侧边面板", exact: true })
    .click();
  await tools.locator('[data-side-pane-open-tab-item="terminal"]').click();
  await page.waitForFunction(() =>
    window.__panels.sidePaneState?.tabs.some((t) => t.type === "terminal"),
  );
  await page.evaluate(() => window.__panels.handleCloseAllSidePaneTabs());
  await page
    .getByTestId("agent-board-tools-toggle")
    .getByRole("button", { name: "展开侧边面板", exact: true })
    .click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("textbox", { name: "会话草稿" }).inputValue(), "保留草稿");
  await page.keyboard.press("Escape");
  await page.getByTestId("agent-board-details").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => window.__frame === document.querySelector("[data-workspace-side-frame]"),
    ),
    true,
    "ordinary renderer must remain mounted",
  );
  await open("Remote ACP 1");
  await page.waitForFunction(() => window.__toolsTarget?.workspaceIdentity === "remote:1");
  await page.evaluate(() =>
    window.__pane.onOpenCodeViewer({ type: "text", title: "Other host", content: "host 1" }),
  );
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Other host" }).waitFor();
  assert.equal(
    await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).count(),
    0,
  );
  for (const width of [390, 1500]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction((width) => {
      const box = document.querySelector("[data-workspace-side-frame]")?.getBoundingClientRect();
      return (
        box && box.x >= 0 && box.right <= width + 1 && (width !== 390 || box.width >= width - 2)
      );
    }, width);
    const box = await tools.boundingBox();
    assert.ok(box && box.width > 0);
    if (width === 390) {
      assert.ok(box.width >= width - 2, "mobile tools use the full width");
      await page.getByTestId("agent-board-conversation-column").waitFor({ state: "hidden" });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: ordinary tools launcher/renderer/owner, review/browser/terminal, multiple tabs, draft retention, remote identities and mobile layout",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
