// Real source picker and preference store; no Host or model calls.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-source-picker-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const artifacts = new URL("../../../output/agent-board-source-picker/", import.meta.url).pathname;
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {AgentBoardSourcePicker} from '../../../ui/src/agent-board/AgentBoardSourcePicker.tsx';
import {agentBoardStore} from '../../../ui/src/store/agentBoardStore.ts';
import '../../../ui/src/styles.css';
const projects=Array.from({length:20},(_,i)=>({key:'/fixture/project-'+i,label:'Project '+i,tabs:[{id:'p'+i,kind:'workspace',workspacePath:'/fixture/project-'+i}]}));
window.__picker={store:agentBoardStore};
function Fixture(){const [open,setOpen]=useState(false);return <>
<button onClick={()=>setOpen(true)}>Browse fixture</button>
{open?<AgentBoardSourcePicker projects={projects} onClose={()=>setOpen(false)}/>:null}</>}
createRoot(document.getElementById('root')).render(<ZCodeIntlProvider><Fixture/></ZCodeIntlProvider>);`,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("picker-initialized")) {
      localStorage.clear();
      localStorage.setItem("zcode-locale-preference", "zh-CN");
      sessionStorage.setItem("picker-initialized", "yes");
    }
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5197") + "/" + name + ".html",
  );
  const dialog = page.getByRole("dialog");
  const open = async () => {
    await page.getByRole("button", { name: "Browse fixture", exact: true }).click();
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
  };
  const button = (label) => dialog.getByRole("button", { name: label, exact: true });
  const labels = ["所有项目", "独立任务", "待办任务"];
  const selected = async (label) => {
    assert.equal(await dialog.getByRole("group").locator('button[aria-pressed="true"]').count(), 1);
    assert.equal(await button(label).getAttribute("aria-pressed"), "true");
  };
  await open();
  await selected(labels[0]);
  for (const [label, category] of [
    [labels[1], "standalone"],
    [labels[2], "work-tasks"],
    [labels[0], "all"],
  ]) {
    await button(label).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(
      await page.evaluate(() => {
        const { category, project } = window.__picker.store.getState();
        return { category, project };
      }),
      { category, project: null },
    );
    await open();
    await selected(label);
  }
  // 从搜索框用 Tab 到第一个入口，Enter 走同一选择命令。
  await dialog.getByRole("textbox").focus();
  await page.keyboard.press("Tab");
  assert.equal(await button(labels[0]).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await open();
  await selected(labels[1]);
  await page.evaluate(() => window.__picker.store.getState().selectProject("/fixture/project-0"));
  assert.equal(await dialog.getByRole("group").locator('button[aria-pressed="true"]').count(), 0);
  await page.evaluate(() => window.__picker.store.getState().selectProject("/missing-project"));
  await selected(labels[0]);

  // 搜索、具体项目和固定操作继续可用。
  await dialog.getByRole("textbox").fill("project-19");
  await button("Project 19 /fixture/project-19").waitFor();
  assert.equal(await button(labels[2]).isVisible(), true);
  await button("固定项目 Project 19").click();
  assert.equal(await button("取消固定项目 Project 19").getAttribute("aria-pressed"), "true");
  await button("Project 19 /fixture/project-19").click();
  await dialog.waitFor({ state: "hidden" });
  await open();
  assert.equal(await dialog.getByRole("group").locator('button[aria-pressed="true"]').count(), 0);
  for (const label of labels)
    assert.equal(await button(label).getAttribute("aria-pressed"), "false");
  await page.evaluate(() => window.__picker.store.getState().selectStandalone());

  for (const [width, theme, locale, fontSize] of [
    [1280, "theme-zai-light", "zh-CN", 14],
    [1280, "dark theme-zai-dark", "en-US", 14],
    [390, "theme-zai-light", "en-US", 20],
    [390, "dark theme-zai-dark", "zh-CN", 14],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      ({ theme, locale, fontSize }) => {
        localStorage.setItem("zcode-locale-preference", locale);
        document.documentElement.className = theme;
        document.documentElement.style.setProperty("--ui-font-size", fontSize + "px");
      },
      { theme, locale, fontSize },
    );
    // Reload reads the same persisted selection and the requested locale.
    await page.reload();
    await page.evaluate(
      ({ theme, fontSize }) => {
        document.documentElement.className = theme;
        document.documentElement.style.setProperty("--ui-font-size", fontSize + "px");
        window.__picker.store.getState().selectStandalone();
      },
      { theme, fontSize },
    );
    await open();
    const quick = dialog.getByRole("group");
    const geometry = await quick.getByRole("button").evaluateAll((buttons) =>
      buttons.map((el) => {
        const box = el.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fits: el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
        };
      }),
    );
    assert.equal(geometry.length, 3);
    assert.ok(geometry.every((b) => Math.abs(b.width - geometry[0].width) < 1));
    assert.ok(geometry.every((b) => b.height >= 44 && b.fits));
    assert.ok(
      width >= 640
        ? geometry.every((b) => b.y === geometry[0].y)
        : geometry.every((b, i) => i === 0 || b.y >= geometry[i - 1].y + geometry[i - 1].height),
    );
    assert.equal(await quick.locator('button[aria-pressed="true"]').count(), 1);
    assert.equal(await quick.locator('button[aria-pressed="true"] svg.lucide-check').count(), 1);
    await dialog
      .getByRole("button", { name: "Project 19 /fixture/project-19", exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(await quick.isVisible(), true);
    assert.ok(Math.abs((await quick.boundingBox()).y - geometry[0].y) < 1);
    assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await dialog
      .getByRole("button", { name: "Project 0 /fixture/project-0", exact: true })
      .scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: join(artifacts, `${width}-${locale}-${fontSize}.png`) });
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: source-picker selection, keyboard, search/pin, equal shortcuts and fixed navigation; desktop/mobile, Zai light/dark, Chinese/English and larger UI text.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
