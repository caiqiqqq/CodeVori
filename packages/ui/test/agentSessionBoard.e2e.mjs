import { exerciseAgentBoardLayout } from "./agentBoardLayoutScenario.mjs";
import { exerciseAgentBoardInterruption } from "./agentBoardInterruptionScenario.mjs";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
import { exerciseAgentBoardWorkTasks } from "./agentBoardWorkTasksScenario.mjs";
// Real board components/data hooks and command routing; synthetic Host and chat pane.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-${process.pid}`;
const html = join(renderer, name + ".html"),
  moduleFile = join(renderer, name + ".tsx");
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5174";
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
  assert.equal(
    await page.locator("[data-board-column]").count(),
    3,
    "24 projects use only 3 display status columns",
  );
  const localConversation = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Implement project 22", exact: true }) });
  const remoteConversation = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 1", exact: true }) });
  for (const card of [localConversation, remoteConversation]) {
    assert.equal(await card.getByText("对话", { exact: true }).count(), 1);
    assert.doesNotMatch(await card.textContent(), /default|Internal chat cwd|remote:1/);
  }
  const realDefaultProject = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Implement project 20", exact: true }) });
  assert.equal(
    await realDefaultProject.getByText("default", { exact: true }).count(),
    2,
    "a real project named default retains project metadata",
  );
  await localConversation.getByRole("button").first().click();
  await page.getByTestId("real-pane-contract").waitFor();
  assert.match(await page.getByRole("dialog").textContent(), /对话/);
  assert.doesNotMatch(await page.getByRole("dialog").textContent(), /default|Internal chat cwd/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByText("独立任务", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("dialog").getByText("对话", { exact: true }).count(), 0);
  assert.doesNotMatch(
    await page.getByRole("dialog").textContent(),
    /Internal chat cwd|\/fixture\/default|remote:1/,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({ path: join(artifacts, "desktop-light.png"), fullPage: true });
  assert.equal(await page.getByRole("tab", { name: /需关注/ }).count(), 0);
  await page.getByRole("tab", { name: /进行中/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  await page.getByRole("tab", { name: /已完成/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 23);
  await page.getByRole("tab", { name: /全部/ }).click();
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("Remote");
  assert.equal(await page.locator("[data-board-card]").count(), 3);
  await page.getByRole("button", { name: /Remote API session/ }).click();
  const pane = page.getByTestId("real-pane-contract");
  await pane.waitFor();
  assert.equal(await pane.getAttribute("data-identity"), "remote:0");
  assert.equal(await pane.getAttribute("data-remote"), "host-0");
  assert.equal(await page.getByRole("button", { name: "标记完成", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "重新打开", exact: true }).count(), 0);
  await page
    .getByRole("dialog")
    .getByText(/Same project · API · 已完成/)
    .waitFor();
  await page.evaluate(() => (window.__board.rejectWrites = true));
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await page.getByText("操作失败，会话状态可能已变化，请刷新后重试", { exact: true }).waitFor();
  await page.evaluate(() => (window.__board.rejectWrites = false));
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await page.getByRole("button", { name: "恢复会话", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__board.commands.at(-1).address.workspaceIdentity),
    "remote:0",
  );
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await page.getByRole("button", { name: "归档", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Remote ACP 0/ }).click();
  await pane.waitFor();
  assert.equal(await pane.getAttribute("data-native-id"), "");
  assert.equal(await pane.getAttribute("data-acp-id"), "same-id");
  await page
    .getByRole("dialog")
    .getByText(/Same project · codex · 已完成/)
    .waitFor();
  await page.getByRole("button", { name: "归档", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__board.commands.at(-1).remoteSessionId), "host-0");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "true",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.getByRole("tab", { name: /归档/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  await page.getByRole("button", { name: /Remote ACP 0/ }).click();
  await page.getByRole("button", { name: "恢复会话", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="real-pane-contract"]')?.dataset.readonly === "false",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /全部/ }).click();
  await page.evaluate(() => window.__board.update(0, { liveStatus: "waiting", updatedAt: 2100 }));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-board-column="running"]')
      ?.textContent.includes("Remote API session"),
  );
  await page.evaluate(() => window.__board.update(0, { liveStatus: "completed", updatedAt: 2100 }));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-board-column="completed"]')
      ?.textContent.includes("Remote API session"),
  );
  const nativeCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote API session", exact: true }) });
  await nativeCard.getByRole("button", { name: "收藏会话", exact: true }).click();
  await nativeCard.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  const acpCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 1", exact: true }) });
  await acpCard.getByRole("button", { name: "收藏会话", exact: true }).click();
  await acpCard.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  await page.evaluate(() => {
    const state = window.__remoteStore.getState();
    window.__disconnected = state.sessionsById["host-0"];
    state.unregisterSession("host-0");
  });
  await nativeCard.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  assert.equal(
    await nativeCard.locator('[data-task-agent-icon="api"] svg').count(),
    1,
    "disconnected remote must not use the local provider logo",
  );
  const disconnectedAcp = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Remote ACP 0", exact: true }) });
  await disconnectedAcp.getByText("离线 · 暂不可操作", { exact: true }).waitFor();
  assert.equal(
    await nativeCard.getByRole("button", { name: "取消收藏", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    const state = window.__remoteStore.getState();
    state.registerSession(window.__disconnected);
    state.bindWorkspaceIdentity("remote:0", "host-0");
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("article"))
        .find((row) => row.textContent.includes("Remote API session"))
        ?.textContent.includes("离线"),
  );
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("button", { name: "固定项目 Project 5", exact: true }).click();
  await page.getByRole("button", { name: "固定项目 Project 6", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "固定项目 Project 7", exact: true }).isDisabled(),
    true,
  );
  await page
    .getByRole("textbox", { name: "搜索项目名称或路径…", exact: true })
    .fill("/fixture/project-23");
  await page.getByRole("button", { name: /Project 23.*project-23/ }).click();
  assert.equal(await page.locator("[data-board-card]").count(), 1);
  await page.evaluate(() => window.__board.store.getState().selectProject(null));
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("Implement project 5");
  await page.getByRole("button", { name: /Implement project 5/ }).click();
  await pane.waitFor();
  assert.equal(await page.getByRole("button", { name: "归档", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.evaluate(() => (document.documentElement.className = "dark theme-zai-dark"));
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector("article")).backgroundColor === "rgb(43, 43, 43)",
  );
  await page.screenshot({ path: join(artifacts, "desktop-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "board scroll remains inside the column container",
  );
  await page.getByRole("button", { name: /Remote API session/ }).click();
  await pane.waitFor();
  await page.waitForFunction(
    () => {
      const r = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
      return r && r.width >= 388 && Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && r.height >= 840;
    },
    {},
    { timeout: 3000 },
  );
  const box = await page.getByRole("dialog").boundingBox();
  assert.ok(
    box.width >= 388 && Math.abs(box.x) < 1 && box.height >= 840,
    "mobile drawer covers viewport",
  );
  await page.screenshot({ path: join(artifacts, "mobile-details.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("no-such-session");
  await page.getByRole("status").filter({ hasText: "没有符合条件的会话" }).waitFor();
  await page.getByRole("textbox", { name: "搜索会话…", exact: true }).fill("");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索项目名称或路径…", exact: true }).fill("project-23");
  await page.getByRole("button", { name: /Project 23.*project-23/ }).click();
  assert.equal(await page.getByTestId("navigation").textContent(), "new:/fixture/project-23");
  await page.setViewportSize({ width: 1600, height: 1000 });
  const manage = () => page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  const save = () => page.getByRole("button", { name: "保存显示范围", exact: true }).click();
  const cancel = () => page.getByRole("button", { name: "取消", exact: true }).click();
  await manage();
  await page.getByRole("radio", { name: "自定义显示", exact: true }).check();
  await save();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    0,
    "empty custom range is intentional",
  );
  await manage();
  await page.getByRole("checkbox", { name: /Implement project 22/ }).check();
  await page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Project 3 / }) })
    .locator("summary")
    .click();
  const project3 = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Project 3 / }) });
  await project3
    .getByRole("checkbox", { name: "自动跟踪此组（含后续新对话）", exact: true })
    .check();
  await save();
  assert.equal(await page.locator("[data-board-card]").count(), 2);
  assert.equal(await page.getByRole("tab", { name: /全部/ }).textContent(), "全部2");
  await manage();
  await page.getByRole("checkbox", { name: /Implement project 22/ }).uncheck();
  await cancel();
  assert.equal(await page.locator("[data-board-card]").count(), 2, "cancel must not apply draft");
  await page.reload();
  await page.getByRole("heading", { name: "Implement project 22", exact: true }).waitFor();
  assert.equal(await page.locator("[data-board-card]").count(), 2, "selection survives reload");
  await page.evaluate(() => {
    window.__board.native.push({
      ...window.__board.native[3],
      taskId: "new-project-session",
      title: "Future project session",
      status: "completed",
      liveStatus: "completed",
    });
    window.__board.update(3, { updatedAt: 5000 });
  });
  await page.getByRole("heading", { name: "Future project session", exact: true }).waitFor();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    3,
    "whole project includes future sessions",
  );
  await manage();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Future project session");
  await page.getByRole("checkbox", { name: /Future project session/ }).uncheck();
  await save();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    2,
    "one session can be excluded from a tracked project",
  );
  await manage();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Remote ACP 0");
  await page.getByRole("checkbox", { name: /Remote ACP 0/ }).check();
  await save();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    3,
    "individual session from untracked project can be added",
  );
  assert.equal(
    await page.getByRole("heading", { name: "Remote API session", exact: true }).count(),
    0,
    "same id in another session kind is not included",
  );
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("button", { name: "独立任务", exact: true }).click();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    1,
    "standalone filter is separate from projects",
  );
  await page.getByRole("button", { name: "独立任务", exact: true }).click();
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({ path: join(artifacts, "custom-tracking.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await manage();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Remote ACP 1");
  await page.getByRole("checkbox", { name: /Remote ACP 1/ }).check();
  await page.screenshot({ path: join(artifacts, "mobile-tracking.png") });
  await save();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    4,
    "mobile can add an independent remote task",
  );
  await manage();
  await page.getByRole("radio", { name: "显示全部", exact: true }).check();
  await save();
  assert.equal(
    await page.locator("[data-board-card]").count(),
    26,
    "all restores hidden sessions without Host mutations",
  );

  await exerciseAgentBoardWorkTasks(page, { manage, save, pane, artifacts });
  await exerciseAgentBoardLayout(page, artifacts);
  await exerciseAgentBoardInterruption(page, artifacts);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real board/hooks; 24 projects; identity routing; API/ACP automatic completion/archive; six-pin limit; search; desktop themes; mobile drawer; new session; work-task selection, scoped conversation, acceptance failure/retry, archive/read-only. Screenshots: " +
      artifacts,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
