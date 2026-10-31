// Real Markdown links and PreviewPane; synthetic Host files and SessionPane transport.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardToolsFixture as agentBoardFixture } from "./agentBoardToolsFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-file-${process.pid}`;
const html = join(renderer, `${name}.html`),
  moduleFile = join(renderer, `${name}.tsx`);
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    import {MessageResponse} from '/@fs${renderer}../../../ui/src/components/ai-elements/message.tsx';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '/@fs${renderer}../../../ui/src/lib/codePreviewSettings.ts';
    export function SessionPane(p){const React=window.__React;const [draft,setDraft]=React.useState('');window.__filePane=p;return React.createElement('div',{className:'p-4'},React.createElement('textarea',{'aria-label':'文件会话草稿',value:draft,onChange:e=>setDraft(e.target.value)}),window.__React.createElement(MessageResponse,{workspacePath:p.workspacePath,workspaceIdentity:p.workspaceIdentity,workspaceRemoteSessionId:p.remoteSessionId,theme:'light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,onOpenFileLink:p.onOpenFileLink,onOpenCodeViewer:p.onOpenCodeViewer},'已准备 [三张运行表的建表脚本](/scripts/create_tables.sql)，可打开检查。'));}
  `,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function V4PaneConversationProvider({children}){return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error('Synthetic transport boundary')}",
    }),
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  const open = async (title) => {
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .getByRole("button")
      .first()
      .click();
  };
  const link = () => page.getByRole("button", { name: /三张运行表的建表脚本/ });
  const preview = () => page.getByTestId("preview-pane");
  const close = () =>
    page
      .locator("[data-workspace-side-frame]")
      .locator("[data-side-pane-tab-id][data-active]")
      .getByRole("button", { name: /^关闭 / })
      .click();
  const codeContains = (text) =>
    page.waitForFunction((text) => {
      const read = (node) =>
        node.nodeType === Node.TEXT_NODE
          ? node.textContent
          : Array.from(node.shadowRoot?.childNodes ?? node.childNodes)
              .map(read)
              .join("");
      const root = document.querySelector('[data-testid="preview-pane"]');
      return root && read(root).includes(text);
    }, text);
  for (const [title, host, workspace] of [
    ["Remote ACP 0", "host-0", "/same"],
    ["Remote ACP 1", "host-1", "/same"],
    ["Remote API session", "host-0", "/same"],
    ["Implement project 4", "local", "/fixture/project-4"],
  ]) {
    await open(title);
    await link().click();
    await preview().waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      1,
      "file opens in the same detail, not another dialog",
    );
    const chat = await page.getByTestId("agent-board-conversation-column").boundingBox();
    const tool = await preview().boundingBox();
    assert.ok(
      chat && tool && tool.x >= chat.x + chat.width - 1,
      "file must appear beside conversation",
    );
    await codeContains("fixture_" + host.replace(/-/g, "_"));
    assert.deepEqual(await page.evaluate(() => window.__board.fileReads.at(-1)), {
      host,
      path: workspace + "/scripts/create_tables.sql",
    });
    await close();
    await link().waitFor();
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "preview-worktree",
      title: "Preview worktree task",
      prompt: "Check SQL",
      status: "review",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: { providerId: "fixture", modelId: "model" },
      },
      session: { kind: "api", id: "execution-session" },
      worktree: { path: "/fixture/execution-tree", branchName: "task/test", baseCommit: "base" },
      merge: {
        id: "merge",
        projectPath: "/fixture/project-3",
        targetBranch: "main",
        phase: "failed",
        session: { kind: "api", id: "merge-session" },
        worktree: { path: "/fixture/merge-tree", branchName: "merge/test", baseCommit: "base" },
      },
      archived: false,
      stopPending: false,
      runSeq: 1,
      createdAt: 100,
      updatedAt: 4000,
    });
    f.notifyWork();
  });
  await open("Preview worktree task");
  for (const workspace of ["/fixture/execution-tree", "/fixture/merge-tree"]) {
    if (workspace.includes("merge-tree"))
      await page.getByTestId("work-task-toggle-merge-conversation").click();
    await link().click();
    await codeContains("fixture_local");
    assert.deepEqual(await page.evaluate(() => window.__board.fileReads.at(-1)), {
      host: "local",
      path: workspace + "/scripts/create_tables.sql",
    });
    await close();
  }
  await page.getByTestId("work-task-back").click();
  await open("Remote ACP 0");
  await page.getByRole("textbox", { name: "文件会话草稿" }).fill("保留文件会话草稿");
  await link().click();
  await codeContains("CREATE TABLE");
  await link().click();
  assert.equal(
    await page.locator("[data-workspace-side-frame]").locator("[data-side-pane-tab-id]").count(),
    1,
  );
  await page.evaluate(() =>
    window.__filePane.onOpenCodeViewer({
      type: "text",
      title: "Second SQL",
      language: "sql",
      content: "SELECT 7;",
    }),
  );
  await page.locator("[data-side-pane-tab-id]").filter({ hasText: "Second SQL" }).waitFor();
  assert.equal(
    await page.locator("[data-workspace-side-frame]").locator("[data-side-pane-tab-id]").count(),
    2,
  );
  await page.locator("[data-side-pane-tab-id]").filter({ hasText: "create_tables.sql" }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "文件会话草稿" }).inputValue(),
    "保留文件会话草稿",
  );
  await close();
  await page
    .locator("[data-side-pane-tab-id][data-active]")
    .filter({ hasText: "Second SQL" })
    .waitFor();
  await close();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") === "true",
  );
  // 缺省 scope 继承当前远端；显式 source 属于另一 Host 时保留原身份。
  for (const explicit of [false, true]) {
    await page.evaluate(
      (explicit) =>
        window.__filePane.onOpenFileLink({
          path: "/scripts/direct.sql",
          label: "Direct SQL",
          workspacePath: explicit ? "/same" : undefined,
          workspaceIdentity: explicit ? "remote:1" : undefined,
          workspaceRemoteSessionId: explicit ? "host-1" : undefined,
        }),
      explicit,
    );
    await codeContains(explicit ? "fixture_host_1" : "fixture_host_0");
    assert.deepEqual(await page.evaluate(() => window.__board.fileReads.at(-1)), {
      host: explicit ? "host-1" : "host-0",
      path: "/scripts/direct.sql",
    });
    await close();
  }
  await page.evaluate(() =>
    window.__filePane.onOpenCodeViewer({
      type: "text",
      title: "Inline SQL",
      content: "SELECT 42;",
      language: "sql",
    }),
  );
  await page.locator("[data-side-pane-tab-id]").filter({ hasText: "Inline SQL" }).waitFor();
  await codeContains("SELECT 42;");
  await close();
  await page.evaluate(() => window.__board.setFileMode("missing"));
  await link().click();
  await preview().getByText("文件不存在", { exact: false }).waitFor();
  await close();
  await page.evaluate(() => window.__board.setFileMode("normal"));
  for (const [width, theme] of [
    [1500, "zai-light"],
    [390, "zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => window.__board.setTheme(theme), theme);
    await link().click();
    await preview().waitFor();
    await codeContains("CREATE TABLE");
    // 普通侧栏展开时短暂锁住旧像素宽度；等待它恢复自适应后验证最终手机布局。
    await page.waitForFunction(() => {
      const preview = document.querySelector('[data-testid="preview-pane"]');
      const box = preview?.getBoundingClientRect();
      return box && box.x >= 0 && box.width <= innerWidth;
    });
    const box = await preview().boundingBox();
    assert.ok(box.x >= 0 && box.width <= width);
    await page.screenshot({
      path: join(artifacts, `board-file-preview-${width}.png`),
      animations: "disabled",
    });
    await close();
  }
  await page.evaluate(() => {
    window.__remoteStore.getState().unregisterSession("host-0");
    window.__board.fileReads.length = 0;
  });
  await link().click();
  await preview().waitFor();
  await preview().getByText("ZCODE_REMOTE_WORKSPACE_DISCONNECTED", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__board.fileReads), []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Markdown file links and PreviewPane in board dialogs; local/remote/native/ACP scope, execution/merge worktrees, source scope fallback/preservation, inline preview, missing file feedback, shared side pane tabs, desktop/mobile themes, offline no local fallback.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
