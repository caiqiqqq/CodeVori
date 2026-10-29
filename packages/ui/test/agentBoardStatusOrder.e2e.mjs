// Real board ordering controls and store; synthetic Native/ACP/WorkTask services.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-order-${process.pid}`;
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
    if (!sessionStorage.getItem("order-fixture-initialized")) {
      localStorage.clear();
      sessionStorage.setItem("order-fixture-initialized", "yes");
    }
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  await page.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  const columns = () =>
    page
      .locator("[data-board-column]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.boardColumn));
  const tabs = () =>
    page
      .getByRole("tablist", { name: "会话范围", exact: true })
      .getByRole("tab")
      .allTextContents()
      .then((labels) => labels.map((label) => label.replace(/\s*\d+$/, "").trim()));
  const labels = { running: "进行中", completed: "已完成", staged: "暂存", error: "失败" };
  const expectOrder = async (order) => {
    await page.getByRole("tablist", { name: "会话范围", exact: true }).waitFor();
    assert.deepEqual(await columns(), order);
    assert.deepEqual(await tabs(), ["全部", ...order.map((status) => labels[status]), "归档"]);
  };
  const open = () => page.getByRole("button", { name: "状态顺序", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "状态顺序", exact: true });
  const close = () => dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.evaluate(() => {
    const f = window.__board;
    f.store.getState().selectProject(null);
    f.store.getState().setGroup("status");
    f.updateAcp(1, { status: "interrupted" });
    f.setSidebar(true);
  });
  const card = (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card("Remote ACP 0").getByRole("button", { name: "暂存", exact: true }).click();
  await card("Remote ACP 0").getByRole("button", { name: "移出暂存", exact: true }).waitFor();
  const countsBefore = await page
    .getByTestId("board-sidebar")
    .getByRole("button", { name: "所有项目", exact: true })
    .getAttribute("aria-description");
  const commandsBefore = await page.evaluate(() => window.__board.commands.length);
  const defaults = ["running", "completed", "staged", "error"];
  await expectOrder(defaults);
  await open();
  assert.equal(
    await dialog.getByRole("button", { name: "上移进行中", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await dialog.getByRole("button", { name: "下移失败", exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole("button", { name: "上移失败", exact: true }).click();
  await dialog.getByRole("button", { name: "上移失败", exact: true }).click();
  const custom = ["running", "error", "completed", "staged"];
  await close();
  await expectOrder(custom);
  const sidebarStatuses = await page
    .getByTestId("board-sidebar")
    .getByRole("button", { name: "所有项目", exact: true })
    .locator("[data-board-sidebar-status]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.boardSidebarStatus));
  assert.deepEqual(sidebarStatuses, custom);
  const countsAfter = await page
    .getByTestId("board-sidebar")
    .getByRole("button", { name: "所有项目", exact: true })
    .getAttribute("aria-description");
  assert.deepEqual(countsAfter.split("，").sort(), countsBefore.split("，").sort());
  await page.evaluate(() => window.__board.setSidebar(false));
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  const down = dialog.getByRole("button", { name: "下移进行中", exact: true });
  await down.focus();
  await page.keyboard.press("Enter");
  await close();
  const mobileOrder = ["error", "running", "completed", "staged"];
  await expectOrder(mobileOrder);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => window.__board.setTheme(theme), theme);
    await open();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({
      path: join(artifacts, "status-order-mobile-" + theme + ".png"),
      animations: "disabled",
    });
    await close();
  }
  assert.equal(
    await page.evaluate(() => window.__board.commands.length),
    commandsBefore,
    "ordering never writes Host state",
  );
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await expectOrder(mobileOrder);
  await open();
  assert.deepEqual(
    await dialog
      .locator("[data-board-order]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.boardOrder)),
    mobileOrder,
  );
  await dialog.getByRole("button", { name: "恢复默认", exact: true }).click();
  await close();
  await expectOrder(defaults);
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await expectOrder(defaults);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: status order buttons, boundaries, keyboard, desktop/mobile themes, shared column/tab/sidebar order, unchanged counts, persistence/reload/reset, no Host commands.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
