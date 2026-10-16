// Real SettingsPage and shortcut hooks; synthetic persistence never writes user settings.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__shortcut-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-shortcut-settings-"));
let server, browser, page;
const errors = [];

async function checkLayout(label) {
  const problems = await page.getByTestId("settings-shortcuts-section").evaluate((section) => {
    const problems = [];
    const bounds = section.getBoundingClientRect();
    for (const row of section.querySelectorAll('[data-testid^="settings-shortcut-row-"]')) {
      const [command, bindings, scope, clear] = row.children;
      const rects = [command, bindings, scope, clear].map((el) => el.getBoundingClientRect());
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i],
            b = rects[j];
          if (
            Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
            Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1
          ) {
            problems.push(`${row.dataset.testid}: overlapping cells ${i}/${j}`);
          }
        }
      }
      if (
        command.scrollWidth > command.clientWidth + 1 ||
        command.firstElementChild.scrollWidth > command.firstElementChild.clientWidth + 1
      ) {
        problems.push(`${row.dataset.testid}: truncated command`);
      }
      for (const el of row.querySelectorAll("button, kbd")) {
        const rect = el.getBoundingClientRect();
        const cell = bindings.contains(el) ? rects[1] : rects[3];
        if (
          rect.left < cell.left - 1 ||
          rect.right > cell.right + 1 ||
          rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1
        ) {
          problems.push(`${el.dataset.testid ?? el.textContent}: exceeds its cell`);
        }
      }
    }
    for (const el of section.querySelectorAll("input, button")) {
      const r = el.getBoundingClientRect();
      if (r.left < bounds.left - 1 || r.right > bounds.right + 1) {
        problems.push(`${el.dataset.testid}: outside section`);
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) problems.push("page overflow");
    return problems;
  });
  assert.deepEqual(problems, [], label);
}

try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {SettingsPage} from '../../../ui/src/SettingsPage.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {setPendingSettingsSection} from '../../../ui/src/lib/settingsNavigation.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],settings:{shortcutBindings:{toggleSidePane:['CmdOrCtrl+Alt+Shift+ArrowRight'],toggleTerminal:[]}}};
    window.__shortcuts=state;state.setTheme=applyTheme;
    const platform:any={onSettingsChanged:()=>()=>{}};
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>state.settings,update:async(patch:any)=>{state.calls.push(patch);state.settings={...state.settings,...patch}}},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    setPendingSettingsSection('shortcuts');
    function Fixture(){
      const [locale,setLocale]=useState('zh-CN'),[desktop,setDesktop]=useState(false);
      state.setLocale=setLocale;state.setDesktop=setDesktop;
      return <PlatformProvider platform={platform}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><SettingsPage isDesktop={desktop} isMacDesktop={desktop}/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      get: () => window.__keyboardPlatform ?? "MacIntel",
    });
  });
  page.setDefaultTimeout(30_000);
  // Real SettingsPage loads the full settings graph; allow cold Vite compilation on busy machines.
  page.setDefaultNavigationTimeout(120_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const row = page.getByTestId("settings-shortcut-row-openCommandCenter");
  await row.waitFor();
  // Capture the screenshot before asserting, so failures retain the original phone layout.
  await page.screenshot({ path: join(artifacts, "phone-initial.png") });
  await checkLayout("Phone layout: complete commands and non-overlapping cells");
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__shortcuts.setLocale(locale), locale);
    await row
      .getByText(locale === "zh-CN" ? "打开命令中心" : "Open Command Center", { exact: true })
      .waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__shortcuts.setTheme(theme), theme);
      for (const width of [320, 375, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await checkLayout(`${locale}/${theme}/${width}`);
        const layout = await row.evaluate((el) => {
          const [command, bindings] = el.children;
          return {
            width: el.parentElement.getBoundingClientRect().width,
            stacked: bindings.getBoundingClientRect().top >= command.getBoundingClientRect().bottom,
          };
        });
        assert.equal(
          layout.stacked,
          layout.width < 768,
          `Responsive container: ${JSON.stringify(layout)}`,
        );
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifacts, `${locale}-${theme}-${width}.png`) });
      }
    }
  }
  // A narrow settings pane inside a wide desktop viewport also needs the phone layout.
  await page.getByTestId("settings-shortcuts-section").evaluate((el) => {
    el.style.width = "250px";
  });
  await checkLayout("250px content in 1280px viewport");
  await page.getByTestId("settings-shortcuts-section").evaluate((el) => {
    el.style.width = "";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const search = page.getByTestId("settings-shortcut-search-input");
  await search.fill("openCommandCenter");
  assert.equal(await page.locator('[data-testid^="settings-shortcut-row-"]').count(), 1);
  await search.fill("");
  await page.getByTestId("settings-shortcut-key-search").tap();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("settings-shortcut-key-search-clear").waitFor();
  assert.equal(await page.locator('[data-testid^="settings-shortcut-row-"]').count(), 1);
  await checkLayout("Captured key search on touch layout");
  await page.getByTestId("settings-shortcut-key-search-clear").tap();
  // Web menu-channel actions remain disabled, including on touch-sized layouts.
  assert.equal(await page.getByTestId("settings-shortcut-edit-newTask-0").isDisabled(), true);
  assert.equal(await page.getByTestId("settings-shortcut-clear-newTask").isDisabled(), true);
  await page.getByTestId("settings-shortcut-edit-openCommandCenter-1").tap();
  await checkLayout("Inline recorder hint");
  await page.keyboard.press("Meta+b");
  await page.getByTestId("settings-shortcut-error-openCommandCenter").waitFor();
  await checkLayout("Inline conflict with steal action");
  await page.screenshot({ path: join(artifacts, "phone-recording-conflict.png") });
  assert.equal(
    await page.evaluate(() => window.__shortcuts.calls.length),
    0,
    "Conflict does not persist",
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-shortcut-edit-openCommandCenter-1").click();
  await page.keyboard.press("Meta+Shift+y");
  await page.waitForFunction(() =>
    window.__shortcuts.calls.some(
      (p) => p.shortcutBindings?.openCommandCenter?.[1] === "CmdOrCtrl+Shift+y",
    ),
  );
  assert.deepEqual(
    await page.evaluate(() => window.__shortcuts.settings.shortcutBindings.openCommandCenter),
    ["CmdOrCtrl+k", "CmdOrCtrl+Shift+y"],
    "Replace preserves the other binding",
  );
  await page.getByTestId("settings-shortcut-clear-openCommandCenter").click();
  await page.getByTestId("settings-shortcut-bind-openCommandCenter-unassigned").waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.__shortcuts.settings.shortcutBindings.openCommandCenter),
    [],
  );
  await checkLayout("Unassigned command after clear");
  await page.evaluate(() => window.__shortcuts.setDesktop(true));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="settings-shortcut-edit-newTask-0"]').disabled,
  );
  assert.equal(await page.getByTestId("settings-shortcut-edit-newTask-0").isEnabled(), true);
  await checkLayout("Desktop retains four aligned columns");
  await page.evaluate(() => {
    window.__keyboardPlatform = "Win32";
    window.__shortcuts.setLocale("zh-CN");
  });
  await row.getByText("打开命令中心", { exact: true }).waitFor();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkLayout(`Windows key labels/${width}`);
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: shortcut settings responsive layout, zh/en, light/dark, narrow pane, search, recording/conflict, replace/clear and Web/desktop menu rules. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
