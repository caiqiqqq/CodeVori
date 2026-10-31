/* eslint-disable max-lines -- 同一端到端流程覆盖远端隔离、工具标签、草稿及工作树切换，保留真实组合交互。 */
// Real board, scoped Git hooks and status UI; synthetic Host and SessionPane transport.
import assert from "node:assert/strict";
import { assertWorkTaskHeaderActions } from "./workspaceToolsBoardScenario.mjs";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardToolsFixture as agentBoardFixture } from "./agentBoardToolsFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-git-${process.pid}`;
const html = join(renderer, `${name}.html`),
  moduleFile = join(renderer, `${name}.tsx`);
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
let browser;
let page;
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
  page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => (errors.push(error.message), console.error(error)));
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    import {MessageResponse} from '/@fs${renderer}../../../ui/src/components/ai-elements/message.tsx';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '/@fs${renderer}../../../ui/src/lib/codePreviewSettings.ts';
    import {ConversationStatusPanel} from '/@fs${renderer}../../../ui/src/v4/ConversationStatusPanel.tsx';
    export function SessionPane(props){
      const React=window.__React;
      const [variant,setVariant]=React.useState('mini');
      const [draft,setDraft]=React.useState('');
      window.__gitPane=props;
      return React.createElement('div',{className:'relative flex h-full min-h-0 flex-col'},
        React.createElement('div',{className:'flex-1 space-y-6 overflow-auto p-6 pt-36'},
          React.createElement('p',{className:'ml-auto max-w-sm rounded-xl border border-border bg-surface p-3'},'检查一下这次的文件修改。'),
          React.createElement('p',{},'合成会话：可以在右侧查看文件差异，同时继续在左侧输入。'),
          React.createElement(MessageResponse,{workspacePath:props.workspacePath,workspaceIdentity:props.workspaceIdentity,workspaceRemoteSessionId:props.remoteSessionId,theme:'light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,onOpenFileLink:props.onOpenFileLink,onOpenCodeViewer:props.onOpenCodeViewer},'查看 [建表脚本](/scripts/create_tables.sql)。'),
          React.createElement('p',{className:'text-foreground-subtle'},'聊天草稿在打开、关闭审查和调整窗口宽度时保留。')),
        React.createElement('textarea',{'aria-label':'消息草稿',className:'m-4 min-h-24 resize-none rounded-xl border border-border bg-background p-3',placeholder:'继续输入消息',value:draft,onChange:e=>setDraft(e.target.value)}),
        React.createElement(ConversationStatusPanel,{...props,summaryPanelVariantOverride:variant,onVariantChange:setVariant,backgroundWorks:[{workId:'synthetic-terminal',kind:'bash',title:'Fixture terminal',status:'running',startedAt:Date.now()-180000}]}));
    }
  `,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function V4PaneConversationProvider({children}){return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error('Synthetic pane transport boundary')}",
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
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .getByRole("button")
      .first()
      .click();
  };
  const mini = () => page.getByRole("button", { name: /展开状态$/ });
  const review = () => page.getByTestId("git-pane");
  const closeReview = () =>
    page
      .locator("[data-workspace-side-frame]")
      .getByRole("button", { name: "关闭 审查", exact: true })
      .click();
  const codeContains = (text) =>
    page.waitForFunction((text) => {
      const read = (node) =>
        node.nodeType === Node.TEXT_NODE
          ? node.textContent
          : Array.from(node.shadowRoot?.childNodes ?? node.childNodes)
              .map(read)
              .join("");
      const root = document.querySelector('[data-testid="git-pane"]');
      return root && read(root).includes(text);
    }, text);
  const facts = async (branch, added) => {
    await page.waitForFunction(
      (branch) => window.__gitPane?.gitSummary?.branchName === branch,
      branch,
    );
    assert.match(await mini().innerText(), new RegExp(String.raw`更改\s*\+${added}\s*-5`));
    assert.equal(
      await page.getByTestId("chat-summary-panel").getAttribute("data-running-terminal-count"),
      "1",
    );
  };
  await open("Remote ACP 0");
  await facts("host-0:/same", 24);
  // macOS 原生窗控高于 DOM 弹窗；普通详情与展开审查后都必须避开顶部 48px。
  const assertMacCaptionSafe = async () => {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="agent-board-conversation-column"]')
          ?.getBoundingClientRect().y >= 48,
    );
    const column = await page.getByTestId("agent-board-conversation-column").boundingBox();
    assert.ok(column.y >= 48, "conversation title must stay below native macOS controls");
    assert.ok(column.y + column.height <= 951, "caption inset must preserve the composer bottom");
  };
  await page.evaluate(() => document.documentElement.classList.add("platform-mac-desktop"));
  await assertMacCaptionSafe();
  await page.getByRole("textbox", { name: "消息草稿" }).fill("保留原对话草稿");
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).click();
  await review().waitFor({ timeout: 10000 });
  const conversation = () => page.getByTestId("agent-board-conversation-column");
  assert.equal(await page.getByRole("dialog").count(), 1, "review must not open another modal");
  const chatBox = await conversation().boundingBox();
  const reviewBox = await review().boundingBox();
  assert.ok(chatBox.width >= 380 && reviewBox.width >= 380);
  assert.ok(reviewBox.x >= chatBox.x + chatBox.width - 1, "review must sit beside the chat");
  await assertMacCaptionSafe();
  assert.ok(reviewBox.y >= 48, "expanded review tabs must also avoid native window controls");
  await page.screenshot({
    path: join(artifacts, "mac-caption-safe-review.png"),
    animations: "disabled",
  });
  // Web/Windows/Linux 不应继承 macOS 的顶部留白。
  for (const platform of ["", "platform-windows-desktop", "platform-linux-desktop"]) {
    await page.evaluate((platform) => {
      document.documentElement.classList.remove(
        "platform-mac-desktop",
        "platform-windows-desktop",
        "platform-linux-desktop",
      );
      if (platform) document.documentElement.classList.add(platform);
    }, platform);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="agent-board-conversation-column"]')
          ?.getBoundingClientRect().y < 2,
    );
    assert.ok(
      (await conversation().boundingBox()).y < 2,
      "non-macOS layout keeps its original top edge",
    );
  }
  await page.evaluate(() => document.documentElement.classList.remove("platform-linux-desktop"));
  await page.getByRole("textbox", { name: "消息草稿" }).fill("审查时也能继续输入");
  const splitter = page.locator("[data-workspace-side-pane-resize-handle]");
  const grip = await splitter.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 90, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  const resizedReviewBox = await review().boundingBox();
  assert.ok(resizedReviewBox.width > reviewBox.width + 40, "splitter should resize review");
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after host-0");
  // 详情与主界面共用侧栏外壳：48px 标签栏、标签搜索、可用的新增入口和独立折叠。
  const tools = () => page.locator("#browser");
  assert.equal(await tools().locator("[data-workspace-side-frame]").count(), 1);
  assert.equal((await tools().getByRole("tablist").boundingBox()).height, 48);
  await tools().getByRole("button", { name: "新增标签", exact: true }).click();
  // 普通侧栏已有审查时不再重复提供该入口；其余工具仍完整可用。
  assert.equal(await page.locator("[data-side-pane-add-item=review]").count(), 0);
  await page.locator("[data-side-pane-add-item=terminal]").waitFor();
  await page.locator("[data-side-pane-add-item=browser]").waitFor();
  await page.keyboard.press("Escape");
  await codeContains("after host-0");
  assert.equal(await tools().locator("[data-side-pane-tab-id]").count(), 1);
  await page.getByRole("button", { name: /建表脚本/ }).click();
  await page.getByTestId("preview-pane").waitFor({ state: "visible" });
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(
    await page.locator("[data-workspace-side-frame]").locator("[data-side-pane-tab-id]").count(),
    2,
  );
  await review().waitFor({ state: "hidden" });
  await tools().getByRole("button", { name: "搜索标签页", exact: true }).click();
  await page.getByPlaceholder("搜索标签页...").fill("审查");
  await page.getByRole("option").filter({ hasText: "审查" }).click();
  await codeContains("after host-0");
  await tools().getByRole("button", { name: "收起侧边面板", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") === "true",
  );
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: /建表脚本/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") ===
      "false",
  );
  assert.equal(await tools().locator("[data-side-pane-tab-id]").count(), 2);
  await page.locator('[data-side-pane-tab-id="git"]').click();
  await codeContains("after host-0");
  assert.equal(
    await page.getByRole("textbox", { name: "消息草稿" }).inputValue(),
    "审查时也能继续输入",
  );
  // 重复文件点击复用标签，审查再次激活应保留已展开的差异。
  await page.getByRole("button", { name: /建表脚本/ }).click();
  assert.equal(
    await page.locator("[data-workspace-side-frame]").locator("[data-side-pane-tab-id]").count(),
    2,
  );
  await page.locator('[data-side-pane-tab-id="git"]').click();
  await codeContains("after host-0");
  await page.locator("[data-side-pane-tab-id]").filter({ hasText: "create_tables.sql" }).click();
  await page
    .locator("[data-side-pane-tab-id]")
    .filter({ hasText: "create_tables.sql" })
    .getByRole("button", { name: "关闭 create_tables.sql", exact: true })
    .click();
  await review().waitFor({ state: "visible" });
  await page.setViewportSize({ width: 390, height: 844 });
  await conversation().waitFor({ state: "hidden" });
  assert.ok((await review().boundingBox()).width >= 380, "mobile review must use the full width");
  await page.setViewportSize({ width: 1500, height: 950 });
  await conversation().waitFor({ state: "visible" });
  await codeContains("after host-0");
  assert.ok(
    (await review().boundingBox()).width >= 380,
    "ordinary shell restores a usable desktop split",
  );
  assert.deepEqual(await page.evaluate(() => window.__board.gitDiffCalls.at(-1)), {
    host: "host-0",
    workspacePath: "/same",
    path: "fixture.ts",
    sourceId: "unstaged",
  });
  assert.deepEqual(
    await page.evaluate(() => window.__board.gitReviews),
    [],
    "review must stay in the board",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") === "true",
  );
  assert.equal(await page.getByRole("dialog").count(), 1, "Escape first closes only review");
  assert.equal(
    await page.getByRole("textbox", { name: "消息草稿" }).inputValue(),
    "审查时也能继续输入",
  );
  await page.keyboard.press("Escape");
  await open("Remote ACP 1");
  await facts("host-1:/same", 44);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+44\s*-5$/ }).click();
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after host-1");
  assert.equal(await page.evaluate(() => window.__board.gitDiffCalls.at(-1).host), "host-1");
  await closeReview();
  await page.keyboard.press("Escape");
  await open("Remote API session");
  await facts("host-0:/same", 24);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).click();
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after host-0");
  await closeReview();
  await page.keyboard.press("Escape");
  await open("Implement project 4");
  await facts("local:/fixture/project-4", 12);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+12\s*-5$/ }).click();
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after local");
  assert.equal(
    await page.evaluate(() => window.__board.gitDiffCalls.at(-1).workspacePath),
    "/fixture/project-4",
  );
  await closeReview();
  await page.keyboard.press("Escape");
  await open("Implement project 4");
  await facts("local:/fixture/project-4", 12);
  await page.evaluate(() => {
    window.__board.setGitMode("clean");
    window.__gitPane.onRefreshGit();
  });
  await page.waitForFunction(() => window.__gitPane.gitDirtyFileCount === 0);
  assert.doesNotMatch(await mini().innerText(), /\+12/);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__board.setGitMode("dirty"));
  // 切换详情后，旧 Host 的迟到响应不能覆盖新详情。
  await page.evaluate(() => {
    window.__board.setGitMode("slow");
    window.__board.gitCalls.length = 0;
  });
  await open("Remote ACP 0");
  await page.waitForFunction(() => window.__board.gitCalls.length === 1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__board.setGitMode("dirty"));
  await open("Remote ACP 1");
  await facts("host-1:/same", 44);
  await page.evaluate(() => window.__board.resolveGit());
  assert.equal(await page.evaluate(() => window.__gitPane.gitSummary.branchName), "host-1:/same");
  await page.keyboard.press("Escape");
  // 原执行和合并会话各自读取真实绑定的工作树。
  await page.evaluate(() => {
    const f = window.__board;
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "git-worktree",
      title: "Git worktree task",
      prompt: "Check worktree",
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
  await open("Git worktree task");
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-testid="agent-board-details"]')?.getBoundingClientRect()
          .width - 640,
      ) < 2,
  );
  await assertWorkTaskHeaderActions(
    page.getByTestId("work-task-content").locator(":scope > header"),
  );
  await facts("local:/fixture/execution-tree", 12);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+12\s*-5$/ }).click();
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after local");
  assert.equal(
    await page.evaluate(() => window.__board.gitDiffCalls.at(-1).workspacePath),
    "/fixture/execution-tree",
  );
  // 仍打开审查时切换绑定，旧工作树标签必须立即丢弃。
  await page.getByTestId("work-task-toggle-merge-conversation").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") === "true",
  );
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-testid="agent-board-details"]')?.getBoundingClientRect()
          .width - 640,
      ) < 2,
  );
  await assertWorkTaskHeaderActions(
    page.getByTestId("work-task-content").locator(":scope > header"),
  );
  await facts("local:/fixture/merge-tree", 12);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+12\s*-5$/ }).click();
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await codeContains("after local");
  assert.equal(
    await page.evaluate(() => window.__board.gitDiffCalls.at(-1).workspacePath),
    "/fixture/merge-tree",
  );
  await closeReview();
  await page.keyboard.press("Escape");
  const fileReadsBeforeDiffReview = await page.evaluate(() => window.__board.fileReads.length);
  for (const [width, theme] of [
    [1500, "theme-zai-light"],
    [1500, "dark theme-zai-dark"],
    [390, "dark theme-zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => (document.documentElement.className = theme), theme);
    await open("Remote ACP 0");
    await facts("host-0:/same", 24);
    await mini().click();
    await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).waitFor();
    await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).click();
    await page.evaluate(() => {
      window.__board.setGitMode("review");
      window.__gitPane.onRefreshGit();
    });
    await review()
      .getByRole("button", { name: /deleted.ts/ })
      .click();
    await codeContains("before host-0");
    await review()
      .getByText('export const value = "before host-0";', { exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll(
        '[data-testid="git-pane"] [data-git-pane-change-virtual-row]',
      );
      return (
        rows.length >= 2 &&
        rows[0].getBoundingClientRect().height > 40 &&
        rows[1].getBoundingClientRect().top >= rows[0].getBoundingClientRect().bottom - 1
      );
    });
    assert.equal(
      await page.evaluate(() => window.__board.fileReads.length),
      fileReadsBeforeDiffReview,
      "deleted files must use Git diff without reading a working file",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      path: join(artifacts, `board-git-${width}${theme.startsWith("dark") ? "-dark" : ""}.png`),
      animations: "disabled",
    });
    await review().getByRole("combobox").click();
    await page.getByRole("option", { name: /已暂存/ }).click();
    await review()
      .getByRole("button", { name: /staged.ts/ })
      .click();
    await codeContains("after host-0");
    assert.equal(await page.evaluate(() => window.__board.gitDiffCalls.at(-1).sourceId), "staged");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") ===
        "true",
    );
    await page.evaluate(() => window.__board.setGitMode("dirty"));
    await page.keyboard.press("Escape");
  }
  await open("Remote ACP 0");
  await facts("host-0:/same", 24);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).click();
  await review().waitFor();
  await page.evaluate(() => window.__board.setGitMode("diff-error"));
  await review()
    .getByRole("button", { name: /fixture.ts/ })
    .click();
  await review().getByText("暂时无法预览这个 Diff", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const registry = window.__remoteStore.getState();
    const session = registry.sessionsById["host-0"];
    window.__board.reconnectGit = () => {
      registry.registerSession(session);
      registry.bindWorkspaceIdentity("remote:0", "host-0");
    };
    registry.unregisterSession("host-0");
    window.__board.gitCalls.length = 0;
  });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-workspace-side-frame]")?.getAttribute("aria-hidden") === "true",
  );
  await page.waitForFunction(() => window.__gitPane.gitSummary.isGitAvailable === false);
  assert.deepEqual(
    await page.evaluate(() => window.__board.gitCalls),
    [],
    "offline must not query local Git",
  );
  await page.evaluate(() => {
    window.__board.setGitMode("dirty");
    window.__board.reconnectGit();
  });
  await page.waitForFunction(() => window.__gitPane.gitSummary.isGitAvailable);
  assert.equal(
    await page.locator("[data-workspace-side-frame]").getAttribute("aria-hidden"),
    "true",
    "reconnection keeps the ordinary collapsed preference",
  );
  assert.equal(
    await page.getByTestId("navigation").innerText(),
    "",
    "review never navigates away from the board",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: board Native/ACP Git floating status, shared GitPane and visible modified/deleted/staged diffs, remote isolation, retained draft, local refresh, stale-response isolation, execution/merge worktree switching, mobile and themes, offline isolation.",
  );
} catch (error) {
  await page?.screenshot({
    path: join(artifacts, "board-git-failure.png"),
    animations: "disabled",
  });
  console.error(
    await page?.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      review: document.querySelector('[data-testid="git-pane"]')?.outerHTML.slice(0, 300),
    })),
  );
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
