// Real settings navigation and page, synthetic platform only; no live LAN listener or user token.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__desktop-lan-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-lan-settings-"));
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
    import {SettingsPage} from '../../../ui/src/SettingsPage.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {setPendingSettingsSectionIntent} from '../../../ui/src/lib/settingsNavigation.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={enabled:false,calls:[],fail:false,holdRead:false,holdWrite:false,token:'synthetic-token-'.repeat(12)};
    window.__lan=state;state.setTheme=applyTheme;state.intent=setPendingSettingsSectionIntent;
    const snapshot=()=>({enabled:state.enabled,urls:state.enabled?['http://192.168.1.23:3030','http://10.0.0.2:3030','http://169.254.1.2:3030']:[],token:state.enabled?state.token:undefined});
    const platform:any={
      getDesktopLanAccess:async()=>{state.calls.push('read');const value=snapshot();if(state.holdRead){state.holdRead=false;await new Promise(resolve=>state.releaseRead=resolve)}return value},
      setDesktopLanAccessEnabled:async(enabled:boolean)=>{state.calls.push(enabled?'enable':'disable');if(state.holdWrite){state.holdWrite=false;await new Promise(resolve=>state.releaseWrite=resolve)}if(state.fail){state.fail=false;if(state.failClosed){state.enabled=false;state.failClosed=false}throw new Error('Synthetic toggle failure')}state.enabled=enabled;return snapshot()},
      onSettingsChanged:()=>()=>{},selectDirectory:async()=>null,
    };
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({})},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    function Fixture(){
      const [mode,setMode]=useState('desktop'),[locale,setLocale]=useState('zh-CN'),[generation,setGeneration]=useState(0);
      state.setMode=setMode;state.setLocale=setLocale;state.remount=()=>setGeneration(v=>v+1);
      return <PlatformProvider platform={mode==='desktop'?platform:{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><SettingsPage key={mode+generation} isDesktop={mode==='desktop'} isMacDesktop={mode==='desktop'}/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
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
  const navigation = page.getByRole("button", { name: /^(局域网手机访问|Phone access over LAN)$/ });
  const general = page.getByRole("button", { name: /^(常规|General)$/ });
  const panel = page.getByTestId("desktop-lan-access");
  const toggle = page.getByTestId("desktop-lan-toggle");
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector('[data-testid="desktop-lan-access"]')?.getAttribute("aria-busy") ===
        "false",
    );
  await navigation.waitFor();
  assert.equal(await panel.count(), 0, "General settings must not contain the LAN panel");
  assert.deepEqual(await page.evaluate(() => window.__lan.calls), []);
  await page.evaluate(() => {
    window.__lan.holdRead = true;
  });
  await navigation.click();
  await panel.waitFor();
  assert.equal(await navigation.getAttribute("aria-current"), "page");
  assert.equal(await toggle.isDisabled(), true, "Wait for the gateway state before toggling");
  await page.waitForFunction(() => Boolean(window.__lan.releaseRead));
  await page.evaluate(() => window.__lan.releaseRead());
  await ready();
  await page.evaluate(() => {
    window.__lan.holdWrite = true;
  });
  await toggle.click();
  assert.equal(await toggle.isDisabled(), true);
  await page.waitForFunction(() => Boolean(window.__lan.releaseWrite));
  await page.evaluate(() => window.__lan.releaseWrite());
  await ready();
  assert.equal(await panel.locator('input[type="password"]').count(), 1);
  assert.equal(await panel.locator('input:not([type="password"])').count(), 3);
  const link = panel.locator("#desktop-lan-url-0");
  assert.equal(
    await link.inputValue(),
    await page.evaluate(
      () => "http://192.168.1.23:3030/?token=" + encodeURIComponent(window.__lan.token),
    ),
  );
  await link.focus();
  assert.equal(
    await link.evaluate((el) => el.selectionEnd - el.selectionStart),
    (await link.inputValue()).length,
  );
  await general.click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__lan.enabled), true);
  await navigation.click();
  await ready();
  assert.equal(await toggle.textContent(), "关闭访问");
  assert.deepEqual(await page.evaluate(() => window.__lan.calls), ["read", "enable", "read"]);

  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__lan.setLocale(locale), locale);
    await ready();
    await page
      .getByRole("button", {
        name: locale === "zh-CN" ? "关闭访问" : "Disable access",
        exact: true,
      })
      .waitFor();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__lan.setTheme(theme), theme);
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const bounds = await panel.boundingBox();
        for (const input of await panel.locator("input").all()) {
          const box = await input.boundingBox();
          assert.ok(
            box.x >= bounds.x + 16 && box.x + box.width <= bounds.x + bounds.width - 16,
            "Fields must retain card padding on both sides",
          );
        }
        await page.screenshot({
          path: join(artifacts, `${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
        assert.equal(
          await link.evaluate((el) => getComputedStyle(el).backgroundColor),
          theme === "zai-light" ? "rgb(255, 255, 255)" : "rgb(43, 43, 43)",
        );
      }
    }
  }
  await page.evaluate(() => {
    window.__lan.fail = true;
  });
  await toggle.click();
  await panel.getByRole("alert").filter({ hasText: "Synthetic toggle failure" }).waitFor();
  assert.equal(
    await panel.locator("input").count(),
    4,
    "Failed disable retains authoritative enabled state",
  );
  await page.evaluate(() => {
    window.__lan.fail = true;
    window.__lan.failClosed = true;
  });
  await toggle.click();
  await ready();
  assert.equal(
    await panel.locator("input").count(),
    0,
    "Read actual disabled state after persistence failure",
  );
  assert.equal(await panel.getByRole("alert").count(), 1, "Preserve the persistence error");
  await toggle.click();
  await ready();
  await toggle.click();
  await ready();
  assert.equal(await panel.locator("input").count(), 0);
  assert.equal(await panel.getByRole("alert").count(), 0);
  await toggle.click();
  await ready();
  await page.evaluate(() => window.__lan.remount());
  await ready();
  assert.equal(
    await panel.locator("input").count(),
    4,
    "Last section and gateway state survive settings remount",
  );
  await page.evaluate(() => window.__lan.setMode("web"));
  await panel.waitFor({ state: "detached" });
  assert.equal(await navigation.count(), 0);
  assert.equal(await general.getAttribute("aria-current"), "page");
  await page.evaluate(() => window.__lan.intent("desktopLan"));
  assert.equal(await general.getAttribute("aria-current"), "page");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real SettingsPage navigation, capability gating, initial read, pending toggle, menu roundtrip, remount, error retry, long URLs, 375/1280px, zh/en, light/dark. Screenshots: ${artifacts}\n`,
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
