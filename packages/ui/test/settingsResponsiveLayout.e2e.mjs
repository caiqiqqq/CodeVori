// Real settings layout and synthetic persistence; no user settings or live Host.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__responsive-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-responsive-settings-"));
let server, browser, page;
const errors = [];
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
    import {SettingsRow} from '../../../ui/src/settings/SettingsPageParts.tsx';
    import {SettingsPage} from '../../../ui/src/SettingsPage.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[]};
    window.__settings=state;state.setTheme=applyTheme;
    const platform:any={onSettingsChanged:()=>()=>{},selectDirectory:async()=>null};
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({}),update:async(value:any)=>{state.calls.push(value)}},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    function Fixture(){
      const [mode,setMode]=useState('desktop'),[locale,setLocale]=useState('zh-CN'),[generation,setGeneration]=useState(0);
      state.setMode=setMode;state.setLocale=setLocale;state.remount=()=>setGeneration(v=>v+1);
      return <PlatformProvider platform={mode==='desktop'?platform:{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider>{mode==='rows'?<div style={{width:280}}>{['default','wide','balanced','compact'].map(layout=><SettingsRow key={layout} label={layout} description={'LongWord'.repeat(12)} controlLayout={layout as any} control={<button style={{width:layout==='compact'?40:260}}>Test</button>} />)}</div>:<SettingsPage key={mode+generation} isDesktop={mode==='desktop'} isMacDesktop={mode==='desktop'}/>}</TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
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
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.waitForFunction(() => Boolean(window.__settings.setMode));
  await page.evaluate(() => window.__settings.setMode("web"));
  const terminalLabels = {
    "zh-CN": ["继承系统终端 Profile", "终端字体"],
    "en-US": ["Inherit system terminal profile", "Terminal font"],
  };
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__settings.setLocale(locale), locale);
    // Wait for the actual localized terminal row before measuring layout.
    const label = page.getByText(terminalLabels[locale][0], { exact: true });
    await label.waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__settings.setTheme(theme), theme);
      for (const width of [320, 375, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const text of terminalLabels[locale]) {
          const row = page.getByText(text, { exact: true }).locator("..").locator("..");
          await row.scrollIntoViewIfNeeded();
          const layout = await row.evaluate((grid) => {
            const [text, control] = grid.children;
            const g = grid.getBoundingClientRect(),
              t = text.getBoundingClientRect(),
              c = control.getBoundingClientRect();
            return {
              width: g.width,
              scrollWidth: grid.scrollWidth,
              clientWidth: grid.clientWidth,
              controlWidth: c.width,
              columns: getComputedStyle(grid).gridTemplateColumns,
              textWidth: t.width,
              stacked: c.top >= t.bottom - 1,
              overflow:
                c.right > g.right + 1 ||
                t.right > g.right + 1 ||
                // Switch expands its touch target 12px into the existing 16px card padding.
                grid.scrollWidth > grid.clientWidth + 16,
            };
          });
          assert.ok(
            !layout.overflow,
            `${locale}/${width}: row must not overflow ${JSON.stringify(layout)}`,
          );
          if (layout.width < 512) {
            assert.ok(
              layout.textWidth >= layout.width * 0.9,
              `${locale}/${width}: text must use available width, got ${JSON.stringify(layout)}`,
            );
            assert.ok(layout.stacked, `${locale}/${width}: controls below the description`);
          } else {
            assert.ok(!layout.stacked, `${locale}/${width}: desktop retains two columns`);
          }
        }
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "No page overflow",
        );
        const grid = label.locator("..").locator("..");
        await grid.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(artifacts, `${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  const row = page
    .getByText(terminalLabels["en-US"][0], { exact: true })
    .locator("..")
    .locator("..");
  const toggle = row.getByRole("switch");
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await page.waitForFunction(() =>
    window.__settings.calls.some(
      (value) => typeof value.terminalInheritSystemProfile === "boolean",
    ),
  );
  assert.notEqual(
    await toggle.getAttribute("aria-checked"),
    before,
    "Terminal toggle remains operable",
  );
  const input = page.getByPlaceholder(/MesloLGS NF/);
  await input.fill("Synthetic Mono");
  const fontCard = input.locator("..").locator("..");
  const save = fontCard.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await page.waitForFunction(() =>
    window.__settings.calls.some((value) => value.terminalFontFamily === "Synthetic Mono"),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.__settings.setMode("rows"));
  for (const layout of ["default", "wide", "balanced", "compact"]) {
    const grid = page.getByText(layout, { exact: true }).locator("..").locator("..");
    const measured = await grid.evaluate((el) => {
      const [text] = el.children;
      return {
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
        overflow: el.scrollWidth > el.clientWidth + 1,
        textOverflow: text.scrollWidth > text.clientWidth + 1,
      };
    });
    assert.equal(
      measured.columns,
      layout === "compact" ? 2 : 1,
      `Narrow ${layout} container in wide viewport`,
    );
    assert.equal(measured.overflow, false);
    assert.equal(measured.textOverflow, false);
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real SettingsPage terminal rows, responsive width, no overflow, toggle and font save, zh/en, light/dark. Screenshots: ${artifacts}\n`,
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
