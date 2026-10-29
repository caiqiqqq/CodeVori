// Real board, scoped Git hooks and status UI; synthetic Host and SessionPane transport.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-git-${process.pid}`;
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
  const errors = [];
  page.on("pageerror", (error) => (errors.push(error.message), console.error(error)));
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    import {ConversationStatusPanel} from '/@fs${renderer}../../../ui/src/v4/ConversationStatusPanel.tsx';
    export function SessionPane(props){const React=window.__React;const [variant,setVariant]=React.useState('mini');window.__gitPane=props;return React.createElement('div',{className:'relative h-full'},React.createElement(ConversationStatusPanel,{...props,summaryPanelVariantOverride:variant,onVariantChange:setVariant,backgroundWorks:[{workId:'synthetic-terminal',kind:'bash',title:'Fixture terminal',status:'running',startedAt:1}]}));}
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
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.__board.gitReviews[0]), {
    scope: { workspacePath: "/same", workspaceIdentity: "remote:0", remoteSessionId: "host-0" },
    sourceId: "unstaged",
  });
  await open("Remote ACP 1");
  await facts("host-1:/same", 44);
  await page.keyboard.press("Escape");
  await open("Remote API session");
  await facts("host-0:/same", 24);
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
  await facts("local:/fixture/execution-tree", 12);
  await page.getByTestId("work-task-toggle-merge-conversation").click();
  await facts("local:/fixture/merge-tree", 12);
  await mini().click();
  await page.getByRole("button", { name: /^更改\s*\+12\s*-5$/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__board.gitReviews.at(-1).scope.workspacePath),
    "/fixture/merge-tree",
  );
  for (const [width, theme] of [
    [1500, "theme-zai-light"],
    [390, "dark theme-zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => (document.documentElement.className = theme), theme);
    await open("Remote ACP 0");
    await facts("host-0:/same", 24);
    await mini().click();
    await page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ }).waitFor();
    await page.screenshot({
      path: join(artifacts, `board-git-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => {
    window.__remoteStore.getState().unregisterSession("host-0");
    window.__board.gitCalls.length = 0;
  });
  await open("Remote ACP 0");
  await page.waitForFunction(() => window.__gitPane.gitSummary.isGitAvailable === false);
  assert.deepEqual(
    await page.evaluate(() => window.__board.gitCalls),
    [],
    "offline must not query local Git",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: board Native/ACP Git floating status, terminals coexist, full remote identity, scoped review closes drawer, local refresh, stale-response isolation, execution/merge worktree switching, mobile and themes, offline isolation.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
