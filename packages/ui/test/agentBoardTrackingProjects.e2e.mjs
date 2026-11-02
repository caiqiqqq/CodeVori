// Real tracking dialog with shared board fixture and synthetic Host services.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-tracking-projects-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  // 同名项目必须继续按原 projectKey 隔离，不能用展示名称分组。
  await writeFile(
    moduleFile,
    agentBoardFixture.replace(
      "const native=tabs.map",
      "tabs[4].label='Project 3';const native=tabs.map",
    ),
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5174") + "/" + name + ".html",
  );
  await page.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  await page.evaluate(() => {
    const f = window.__board;
    for (const [index, id, status, archived] of [
      [3, "Alpha task", "running", false],
      [3, "Beta task", "review", false],
      [4, "Gamma task", "todo", false],
      [0, "Remote task", "running", false],
      [5, "Archived only", "review", true],
      [6, "Completed only", "done", false],
    ]) {
      const tab = f.tabs[index];
      f.workRows.push({
        workspacePath: tab.workspacePath,
        workspaceIdentity: tab.workspaceIdentity,
        remoteSessionId: tab.remoteSessionId,
        id,
        title: id,
        prompt: "Fixture",
        status,
        archived,
        execution: { kind: "acp", agent: "codex" },
        stopPending: false,
        runSeq: 1,
        createdAt: 100,
        updatedAt: 7000,
      });
    }
    f.notifyWork();
    f.store.getState().setTracking({ ...f.store.getState().tracking, mode: "custom" });
  });
  const manage = async () => {
    const filters = page.getByRole("button", { name: /^筛选/ });
    if ((await filters.isVisible()) && (await filters.getAttribute("aria-expanded")) === "false")
      await filters.click();
    await page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  };
  const dialog = page.getByRole("dialog");
  const search = dialog.getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true });
  const groups = dialog.getByTestId("tracking-work-task-project");
  const project = (key) => groups.filter({ has: page.locator(`[title="${key}"]`) });
  const tasks = dialog
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: /^待办任务/ }) });
  const candidate = (title) => dialog.getByRole("checkbox", { name: new RegExp(title) });
  const save = () => dialog.getByRole("button", { name: "保存显示范围", exact: true }).click();
  await manage();
  await tasks.locator("summary").click();
  await project("/fixture/project-3").waitFor();
  assert.equal(await groups.count(), 3);
  assert.equal(await project("/fixture/project-3").getByRole("checkbox").count(), 2);
  assert.equal(await project("/fixture/project-4").getByRole("checkbox").count(), 1);
  assert.equal(await project("/fixture/project-5").count(), 0);
  assert.equal(await project("/fixture/project-6").count(), 0);
  assert.equal(await project("/fixture/project-8").count(), 0);
  await search.fill("Project 3");
  assert.equal(await groups.count(), 2, "same name retains separate project groups");
  await search.fill("/fixture/project-4");
  assert.equal(await groups.count(), 1);
  await candidate("Gamma task").waitFor();
  await search.fill("Alpha task");
  assert.equal(await groups.count(), 1);
  assert.match(
    await project("/fixture/project-3").getByRole("heading").textContent(),
    /Project 3\s*1/,
  );
  await candidate("Alpha task").check();
  await search.fill("Codex");
  assert.equal(await groups.count(), 3);
  await search.fill("remote:0");
  assert.equal(await groups.count(), 1);
  await candidate("Remote task").check();
  await save();
  await manage();
  await search.fill("Alpha task");
  assert.equal(await candidate("Alpha task").isChecked(), true);
  await search.fill("Remote task");
  assert.equal(await candidate("Remote task").isChecked(), true);
  await search.fill("待办任务");
  await tasks.getByRole("checkbox", { name: "自动跟踪此组（含后续新任务）", exact: true }).check();
  assert.equal(await candidate("Gamma task").isChecked(), true);
  await candidate("Beta task").uncheck();
  await save();
  for (const [width, theme] of [
    [1500, "zai-light"],
    [390, "zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => window.__board.setTheme(value), theme);
    await manage();
    await search.fill("待办任务");
    assert.equal(await groups.count(), 3);
    assert.equal(await candidate("Beta task").isChecked(), false);
    assert.equal(await candidate("Gamma task").isChecked(), true);
    assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    await page.screenshot({
      path: join(artifacts, `board-tracking-projects-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  await manage();
  await search.fill("待办任务");
  await page.evaluate(() => {
    for (const row of window.__board.workRows) row.archived = true;
    window.__board.notifyWork();
  });
  await groups.first().waitFor({ state: "hidden" });
  assert.equal(await tasks.count(), 0, "empty work-task root is hidden even if its name matches");
  assert.equal(await page.evaluate(() => window.__board.commands.length), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: nonempty work-task project groups; same-name isolation; project/path/title/Agent search; saved item/global rules; live empty removal; desktop/mobile themes.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
