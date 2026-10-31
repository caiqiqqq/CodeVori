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
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, hasTouch: true });
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
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Outside navigation";
    button.style.cssText = "position:fixed;top:0;left:0;z-index:100";
    document.body.append(button);
  });
  const outside = page.getByRole("button", { name: "Outside navigation", exact: true });
  const details = page.getByTestId("agent-board-details");
  const assertDrawer = async () => {
    await page.waitForFunction(() => {
      const box = document
        .querySelector('[data-testid="agent-board-details"]')
        ?.getBoundingClientRect();
      return (
        box && Math.abs(box.width - 640) < 2 && box.x > 0 && Math.abs(box.right - innerWidth) < 2
      );
    });
    const actions = await page.getByTestId("agent-board-header-actions").boundingBox();
    const drawer = await details.boundingBox();
    assert.ok(
      actions && drawer && Math.abs(drawer.x + drawer.width - actions.x - actions.width - 16) < 2,
    );
    assert.equal(
      await details.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return !element.contains(document.elementFromPoint(box.left - 20, box.top + 100));
      }),
      true,
      "board stays accessible beside the drawer",
    );
  };
  await open("Remote ACP 0");
  await assertDrawer();
  await page.getByRole("textbox", { name: "会话草稿" }).fill("外点前草稿");
  await details.getByRole("heading", { name: "Remote ACP 0", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "会话草稿" }).inputValue(), "外点前草稿");
  await outside.focus();
  await outside.click({ button: "right" });
  assert.equal(await details.count(), 1, "focus changes and secondary clicks keep the drawer");
  await page.getByRole("heading", { name: /^Agent 看板/ }).click();
  await details.waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__toolsTarget === null);
  await open("Remote ACP 0");
  await assertDrawer();
  const longTitle = "检查超长会话标题下的右侧操作位置".repeat(8);
  await page.evaluate((title) => window.__board.updateAcp(0, { title }), longTitle);
  await assertDrawer();
  await page.getByRole("textbox", { name: "会话草稿" }).fill("保留草稿");
  await page.evaluate(() => {
    window.__draft = document.querySelector('textarea[aria-label="会话草稿"]');
  });
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
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).click();
  await tools.locator("[data-side-pane-add-trigger]").click();
  await page.locator('[data-side-pane-add-item="browser"]').click();
  assert.equal(
    await details.count(),
    1,
    "tool tabs and their portaled menus preserve the conversation",
  );
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).click();
  assert.equal(
    await page.evaluate(
      () => window.__draft === document.querySelector('textarea[aria-label="会话草稿"]'),
    ),
    true,
  );
  await tools.getByRole("button", { name: "收起侧边面板", exact: true }).click();
  await assertDrawer();
  assert.equal(await page.getByRole("textbox", { name: "会话草稿" }).inputValue(), "保留草稿");
  await page.getByTestId("agent-board-tools-toggle").getByTestId("side-pane-toggle").click();
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).waitFor();
  await outside.click();
  await details.waitFor({ state: "hidden" });
  await open(longTitle);
  await assertDrawer();
  assert.equal(
    await page.evaluate(() => window.__panels.sidePaneState.tabs.length),
    3,
    "reopening collapses without deleting tabs",
  );
  await page.getByRole("textbox", { name: "会话草稿" }).fill("保留草稿");
  await page.getByTestId("agent-board-tools-toggle").getByTestId("side-pane-toggle").click();
  await tools.locator("[data-side-pane-tab-id]").filter({ hasText: "Shared file" }).waitFor();
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
  await assertDrawer();
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
  await page.keyboard.press("Escape");
  await assertDrawer();
  // The visible board can switch the drawer directly without closing it first.
  await open("Remote API session");
  await assertDrawer();
  await outside.click();
  await details.waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__toolsTarget === null);
  await page.evaluate(() => {
    const f = window.__board;
    f.services.workTaskService.getEvents = async () => [];
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "outside-work",
      title: "Outside work task",
      prompt: "Task prompt",
      status: "review",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "fixture", modelId: "model" },
      },
      session: { kind: "api", id: "outside-work-session" },
      worktree: {
        path: "/fixture/outside-work-tree",
        branchName: "task/outside",
        baseCommit: "base",
      },
      runText: "Task prompt",
      commandId: "command",
      sessionRequestId: "request",
      archived: false,
      stopPending: false,
      runSeq: 1,
      createdAt: 100,
      updatedAt: 4000,
    });
    f.notifyWork();
  });
  await open("Outside work task");
  await page.getByTestId("work-task-content").waitFor();
  await page.getByTestId("work-task-complete").click();
  const completion = page.getByTestId("work-task-completion-dialog");
  await completion.waitFor();
  await completion.getByTestId("work-task-completion-title").click();
  assert.equal(await details.count(), 1, "work task confirmation keeps the underlying drawer");
  await page.keyboard.press("Escape");
  await completion.waitFor({ state: "hidden" });
  await page
    .getByTestId("work-task-content")
    .getByRole("heading", { name: "Outside work task", exact: true })
    .click();
  await outside.click();
  await details.waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__toolsTarget === null);
  await open("Remote ACP 1");
  await page.setViewportSize({ width: 390, height: 900 });
  await outside.tap();
  await details.waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__toolsTarget === null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: outside click/tap dismisses Native/ACP/WorkTask details; focus, secondary clicks, internal tools/menus/confirmation preserve them; scope cleanup, card switching, retained tabs/drafts and mobile layout",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
