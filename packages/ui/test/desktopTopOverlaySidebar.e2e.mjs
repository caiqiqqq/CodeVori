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
    import icon from '../../../ui/src/assets/provider-icons/logo-zai.svg';
    import '../../../ui/src/styles.css';
    const state:any={toggles:0,back:0,forward:0,create:0};window.__overlay=state;state.theme=applyTheme;
    function Fixture(){
      const [config,setConfig]=useState({name:'mac',isDesktop:true,isMacDesktop:true,isWindowsDesktop:false,isMacFullscreen:false});
      const [visible,setVisible]=useState(false);const [locale,setLocale]=useState('zh-CN');
      state.config=setConfig;state.locale=setLocale;state.name=config.name;state.visible=visible;
      return <ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><main className='relative h-dvh bg-background text-foreground' style={{'--workspace-sidebar-panel-width':'260px'} as React.CSSProperties}>
        {visible?<aside data-testid='synthetic-sidebar' className='absolute top-14 bottom-0 w-60 border-r border-border bg-sidebar'>Sidebar</aside>:null}
        <DesktopTopOverlay {...config} workspaceAbsPath='/synthetic' isSidebarVisible={visible} appLogoUrl={icon} platform={{} as any} macWindowControlsLeftPaddingPx={96}
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
  page = await browser.newPage({
    viewport: { width: 1280, height: 812 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByRole("button", { name: "切换侧边栏", exact: true }).first().waitFor();
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
    await page.evaluate((locale) => window.__overlay.locale(locale), locale);
    const toggle = page.getByRole("button", {
      name: locale === "zh-CN" ? "切换侧边栏" : "Toggle sidebar",
      exact: true,
    });
    await toggle.first().waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__overlay.theme(theme), theme);
      for (const config of modes) {
        await page.setViewportSize({ width: config.width, height: 812 });
        await page.evaluate((config) => window.__overlay.config(config), config);
        await page.waitForFunction((name) => window.__overlay.name === name, config.name);
        assert.equal(
          await toggle.count(),
          1,
          `${config.name} must expose exactly one sidebar toggle`,
        );
        const logo = page.getByRole("img");
        assert.equal(await logo.count(), config.isMacDesktop ? 1 : 0);
        const before = await page.evaluate(() => window.__overlay.toggles);
        if (config.isMacDesktop) {
          assert.equal(
            await logo.evaluate(
              (el) => el.closest('button,[role="button"],a') === null && el.tabIndex < 0,
            ),
            true,
          );
          await logo.hover();
          assert.equal(await logo.evaluate((el) => getComputedStyle(el).opacity), "1");
          await logo.click();
          assert.equal(
            await page.evaluate(() => window.__overlay.toggles),
            before,
            "Logo must not toggle the sidebar",
          );
        }
        await toggle.click();
        await page.getByTestId("synthetic-sidebar").waitFor();
        assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 1);
        await toggle.focus();
        await page.keyboard.press("Enter");
        await page.getByTestId("synthetic-sidebar").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 2);
        await toggle.tap();
        await page.getByTestId("synthetic-sidebar").waitFor();
        await toggle.tap();
        await page.getByTestId("synthetic-sidebar").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.__overlay.toggles), before + 4);
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
  const calls = await page.evaluate(() => ({
    back: window.__overlay.back,
    forward: window.__overlay.forward,
    create: window.__overlay.create,
  }));
  assert.deepEqual(calls, { back: 24, forward: 24, create: 24 });
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: single sidebar toggle, noninteractive macOS Logo, click/keyboard/touch and navigation at macOS/fullscreen/Windows/Linux/mobile Web, zh/en and light/dark. Screenshots: ${artifacts}\n`,
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
