// Real board tracking dialog and state; synthetic Native/ACP/WorkTask services.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-tracking-${process.pid}`;
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  await page.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  const expected = await page.evaluate(() => {
    const f = window.__board;
    f.update(22, { archived: true });
    f.updateAcp(0, { archived: true });
    for (const [id, status, archived] of [
      ["active-review", "review", false],
      ["archived-review", "review", true],
      ["completed-task", "done", false],
    ]) {
      f.workRows.push({
        workspacePath: "/fixture/project-3",
        id,
        title: id,
        prompt: "Fixture",
        status,
        archived,
        execution: {
          kind: "api",
          mode: "build",
          modelSelection: { providerId: "fixture-provider", modelId: "model" },
        },
        stopPending: false,
        runSeq: 1,
        createdAt: 100,
        updatedAt: 7000,
      });
    }
    f.notifyWork();
    const legacy = JSON.stringify(["/fixture/project-7", "native", "same-id"]);
    f.store.getState().setTracking({ ...f.store.getState().tracking, includedItems: [legacy] });
    return (
      f.native.filter((row) => !row.archived).length +
      f.acp.filter((row) => !row.archived).length +
      1
    );
  });
  const manage = () => page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  const dialog = () => page.getByRole("dialog");
  const search = () =>
    dialog().getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true });
  const candidate = (name) => dialog().getByRole("checkbox", { name: new RegExp(name) });
  const count = (n) =>
    dialog()
      .getByText("当前范围包含 " + n + " 项", { exact: true })
      .waitFor();
  const save = () => dialog().getByRole("button", { name: "保存显示范围", exact: true }).click();
  await manage();
  await count(expected);
  for (const name of [
    "Implement project 7",
    "Implement project 22",
    "Remote ACP 0",
    "archived-review",
    "completed-task",
  ]) {
    await search().fill(name);
    assert.equal(
      await candidate(name).count(),
      0,
      "archived/completed candidates cannot be searched",
    );
    await count(expected);
  }
  await dialog().getByRole("radio", { name: "自定义显示", exact: true }).check();
  await count(0);
  await search().fill("Remote ACP 1");
  await candidate("Remote ACP 1").check();
  await count(1);
  await search().fill("active-review");
  await candidate("active-review").check();
  await count(2);
  await save();
  assert.equal(
    await page.evaluate(() => window.__board.commands.length),
    0,
    "scope selection does not mutate Host records",
  );
  await manage();
  await search().fill("Remote ACP 1");
  await page.evaluate(() => window.__board.updateAcp(1, { archived: true }));
  await candidate("Remote ACP 1").waitFor({ state: "hidden" });
  await count(1);
  await page.evaluate(() => window.__board.updateAcp(1, { archived: false }));
  await candidate("Remote ACP 1").waitFor();
  assert.equal(
    await candidate("Remote ACP 1").isChecked(),
    true,
    "restore preserves item selection",
  );
  await count(2);
  await page.evaluate(() => window.__board.update(7, { archived: false }));
  await search().fill("Implement project 7");
  await candidate("Implement project 7").waitFor();
  assert.equal(
    await candidate("Implement project 7").isChecked(),
    true,
    "hidden legacy rules remain available after restore",
  );
  await count(3);
  await page.evaluate(() => window.__board.update(7, { archived: true }));
  await candidate("Implement project 7").waitFor({ state: "hidden" });
  await count(2);
  await search().fill("Project 3");
  const group = dialog()
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Project 3 / }) });
  assert.match(await group.locator("summary").textContent(), /Project 3\s*1/);
  await group.getByRole("checkbox", { name: "自动跟踪此组（含后续新对话）", exact: true }).check();
  await count(3);
  await save();
  const preserved = await page.evaluate(
    () => window.__board.store.getState().tracking.includedItems,
  );
  assert.ok(preserved.includes(JSON.stringify(["/fixture/project-7", "native", "same-id"])));
  for (const [width, theme] of [
    [1500, "zai-light"],
    [390, "zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => window.__board.setTheme(theme), theme);
    await manage();
    await search().fill("Remote ACP");
    assert.equal(await candidate("Remote ACP 0").count(), 0);
    assert.equal(await candidate("Remote ACP 1").isChecked(), true);
    await count(3);
    await page.screenshot({
      path: join(artifacts, `board-tracking-archive-${width}.png`),
      animations: "disabled",
    });
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: archived Native/ACP/WorkTask excluded from candidates/search/group/count; live archive/restore; legacy rules preserved; selection/save/cancel; desktop/mobile themes.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
