// Real global navigation with local fixture state; no Host, Agent or user settings.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__top-overlay-sidebar-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-top-overlay-sidebar-"));
let server, browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {DesktopTopOverlay} from '../../../ui/src/DesktopTopOverlay.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={toggles:0,back:0,forward:0,create:0};window.__overlay=state;state.theme=applyTheme;
    function Fixture(){
      const [config,setConfig]=useState({name:'mac',isDesktop:true,isMacDesktop:true,isWindowsDesktop:false,isMacFullscreen:false});
      const [visible,setVisible]=useState(false);const [locale,setLocale]=useState('zh-CN');
      state.config=setConfig;state.locale=setLocale;state.name=config.name;state.visible=visible;
      return <ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><main className='relative h-dvh bg-background text-foreground' style={{'--workspace-sidebar-panel-width':'260px'} as React.CSSProperties}>
        {visible?<aside data-testid='synthetic-sidebar' className='absolute top-14 bottom-0 w-60 border-r border-border bg-sidebar'>Sidebar</aside>:null}
        <DesktopTopOverlay {...config} workspaceAbsPath='/synthetic' isSidebarVisible={visible} platform={{} as any} macWindowControlsLeftPaddingPx={96}
          updateReadyVersion={null} updateState={null} toggleSidebarShortcutLabel='⌘B' newTaskShortcutLabel='' goBackShortcutLabel='' goForwardShortcutLabel=''
          canTaskNavBack canTaskNavForward canGoBack canGoForward showNewTaskButton
          onToggleSidebar={()=>{state.toggles++;setVisible(v=>!v)}} onGoBack={()=>state.back++} onGoForward={()=>state.forward++} onCreateTask={()=>state.create++}/>
      </main></TooltipProvider></ZCodeIntlProvider>;
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
  const pages = [];
  for (const hasTouch of [false, true]) {
    const fixture = await browser.newPage({
      viewport: { width: 1280, height: 812 },
      hasTouch,
      reducedMotion: "reduce",
    });
    fixture.on("pageerror", (error) => errors.push(error.message));
    fixture.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await fixture.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
    await fixture.getByRole("button", { name: "切换侧边栏", exact: true }).waitFor();
    pages.push(fixture);
  }
  const modes = [
    {
      name: "mac",
      isDesktop: true,
      isMacDesktop: true,
      isMacFullscreen: false,
      isWindowsDesktop: false,
      width: 1280,
    },
    {
      name: "mac-fullscreen",
      isDesktop: true,
      isMacDesktop: true,
      isMacFullscreen: true,
      isWindowsDesktop: false,
      width: 1280,
    },
    {
      name: "windows",
      isDesktop: true,
      isMacDesktop: false,
      isMacFullscreen: false,
      isWindowsDesktop: true,
      width: 1280,
    },
    {
      name: "linux",
      isDesktop: true,
      isMacDesktop: false,
      isMacFullscreen: false,
      isWindowsDesktop: false,
      width: 1280,
    },
    ...[320, 390].map((width) => ({
      name: `web-${width}`,
      isDesktop: false,
      isMacDesktop: false,
      isMacFullscreen: false,
      isWindowsDesktop: false,
      width,
    })),
  ];
  for (const locale of ["zh-CN", "en-US"]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      for (const config of modes) {
        page = pages[config.isDesktop ? 0 : 1];
        await page.evaluate((locale) => window.__overlay.locale(locale), locale);
        const toggle = page.getByRole("button", {
          name: locale === "zh-CN" ? "切换侧边栏" : "Toggle sidebar",
          exact: true,
        });
        await toggle.waitFor();
        await page.evaluate((theme) => window.__overlay.theme(theme), theme);
        await page.setViewportSize({ width: config.width, height: 812 });
        await page.evaluate((config) => window.__overlay.config(config), config);
        await page.waitForFunction((name) => window.__overlay.name === name, config.name);
        assert.equal(
          await toggle.count(),
          1,
          `${config.name} must expose exactly one sidebar toggle`,
        );
        // 移除 V 本身，不能只合并点击区域或在 hover 时隐藏品牌图标。
        assert.equal(await page.getByRole("img").count(), 0, "Navigation must not render a Logo");
        const icon = (visible) =>
          toggle.locator(visible ? "svg.lucide-panel-left-close" : "svg.lucide-panel-left-open");
        await icon(false).waitFor({ state: "visible" });
        const before = await page.evaluate(() => window.__overlay.toggles);
        const slot = await toggle.boundingBox();
        const back = await page.getByTestId("desktop-top-nav-back").boundingBox();
        assert.ok(
          back.x >= slot.x + slot.width && back.x - (slot.x + slot.width) <= 5,
          "Back follows the sidebar button directly without a brand slot",
        );
        if (config.isDesktop) {
          await toggle.hover();
          await icon(false).waitFor({ state: "visible" });
          assert.equal(await page.getByRole("img").count(), 0, "Hover must not restore a Logo");
          assert.equal(
            await page.evaluate(() => window.__overlay.toggles),
            before,
            "Hover has no action",
          );
        }
        await toggle.click();
        await page.getByTestId("synthetic-sidebar").waitFor();
        assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 1);
        await icon(true).waitFor({ state: "visible" });
        await toggle.focus();
        if (config.isMacDesktop) {
          await page.mouse.move(config.width - 1, 800);
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
        }
        await icon(true).waitFor({ state: "visible" });
        assert.equal(await page.getByRole("img").count(), 0, "Focus must not restore a Logo");
        await page.keyboard.press("Enter");
        await page.getByTestId("synthetic-sidebar").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 2);
        await icon(false).waitFor({ state: "visible" });
        if (!config.isDesktop) {
          await toggle.tap();
          await page.getByTestId("synthetic-sidebar").waitFor();
          await toggle.tap();
          await page.getByTestId("synthetic-sidebar").waitFor({ state: "detached" });
          assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 4);
        }
        const bounds = await toggle.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= config.width);
        await page.getByTestId("desktop-top-nav-back").click();
        await page
          .getByRole("button", { name: locale === "zh-CN" ? "前进" : "Go forward", exact: true })
          .click();
        await page
          .getByRole("button", { name: locale === "zh-CN" ? "新建任务" : "New task", exact: true })
          .click();
        await page.screenshot({ path: join(artifacts, `${config.name}-${locale}-${theme}.png`) });
      }
    }
  }
  const calls = { back: 0, forward: 0, create: 0 };
  for (const fixture of pages) {
    const counts = await fixture.evaluate(() => ({
      back: window.__overlay.back,
      forward: window.__overlay.forward,
      create: window.__overlay.create,
    }));
    for (const key of Object.keys(calls)) calls[key] += counts[key];
  }
  assert.deepEqual(calls, { back: 24, forward: 24, create: 24 });
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: single sidebar icon without Logo, click/keyboard/touch and navigation at macOS/fullscreen/Windows/Linux/mobile Web, zh/en and light/dark. Screenshots: ${artifacts}\n`,
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
