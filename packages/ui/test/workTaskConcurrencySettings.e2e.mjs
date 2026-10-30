// Real SettingsPage and settings hook; synthetic persistence, no live user settings or Host.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__work-task-concurrency-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "work-task-concurrency-settings-"));
let server, browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script>`,
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
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],settings:JSON.parse(localStorage.getItem('concurrency-fixture')??'{}'),fail:false,hold:false};
    window.__settings=state;state.setTheme=applyTheme;
    const platform:any={onSettingsChanged:()=>()=>{},syncAppSettings:()=>{},selectDirectory:async()=>null};
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({...state.settings}),update:async(patch:any)=>{
      state.calls.push(patch);
      if(state.hold)await new Promise(resolve=>state.release=resolve);
      if(state.fail){state.fail=false;throw Error('Synthetic save failure')}
      Object.assign(state.settings,patch);localStorage.setItem('concurrency-fixture',JSON.stringify(state.settings));
    }},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    function Fixture(){
      const [mode,setMode]=useState('desktop'),[locale,setLocale]=useState('zh-CN');
      state.setMode=setMode;state.setLocale=setLocale;
      return <PlatformProvider platform={platform}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><SettingsPage key={mode} isDesktop={mode==='desktop'} isMacDesktop={mode==='desktop'}/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
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
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZCODE_E2E_CHROMIUM ? { executablePath: process.env.ZCODE_E2E_CHROMIUM } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const zhLabel = "待办任务并发上限";
  let control = page.getByRole("spinbutton", { name: zhLabel, exact: true });
  await control.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="待办任务并发上限"]').disabled,
  );
  const save = page.getByRole("button", { name: "保存待办任务并发上限", exact: true });
  assert.equal(await control.inputValue(), "4");
  assert.equal(await control.getAttribute("max"), null, "No fixed maximum");
  for (const invalid of ["", "0", "-1", "1.5"]) {
    await control.fill(invalid);
    assert.equal(await control.getAttribute("aria-invalid"), "true");
    assert.equal(await save.isDisabled(), true);
  }
  await control.fill("16");
  assert.equal(
    await page.evaluate(() => window.__settings.calls.length),
    0,
    "Editing alone does not change admission",
  );
  await save.click();
  await page.waitForFunction(() => window.__settings.settings.workTaskConcurrency === 16);
  assert.equal(await control.inputValue(), "16");
  await page.reload();
  await control.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="待办任务并发上限"]').value === "16",
  );
  await page.evaluate(() => {
    window.__settings.fail = true;
  });
  await control.fill("3");
  await save.click();
  await page.getByRole("alert").filter({ hasText: "保存并发上限失败" }).waitFor();
  assert.equal(await control.inputValue(), "3", "Rejected value remains an editable draft");
  assert.equal(await page.evaluate(() => window.__settings.settings.workTaskConcurrency), 16);
  await page.evaluate(() => {
    window.__settings.hold = true;
  });
  await control.fill("8");
  await save.click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="待办任务并发上限"]').disabled,
  );
  await page.evaluate(() => {
    window.__settings.hold = false;
    window.__settings.release();
  });
  await page.waitForFunction(() => window.__settings.settings.workTaskConcurrency === 8);
  await control.fill("12");
  await control.press("Enter");
  await page.waitForFunction(() => window.__settings.settings.workTaskConcurrency === 12);
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__settings.setLocale(locale), locale);
    control = page.getByRole("spinbutton", {
      name: locale === "zh-CN" ? zhLabel : "Concurrent to-do tasks",
      exact: true,
    });
    await control.waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__settings.setTheme(theme), theme);
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (width) => window.__settings.setMode(width < 600 ? "web" : "desktop"),
          width,
        );
        await control.scrollIntoViewIfNeeded();
        assert.ok(
          await control.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth;
          }),
          "Control fits mobile and desktop",
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "No horizontal page overflow",
        );
        await page.screenshot({ path: join(artifacts, `${locale}-${theme}-${width}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: real SettingsPage positive concurrency input without fixed maximum, validation, reload persistence, rejected/pending saves, mobile/desktop, zh/en and light/dark. Synthetic settings transport. Artifacts: ${artifacts}`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}; page errors: ${errors.join("; ")}; artifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
