// Synthetic settings only; never changes a user's proxy or contacts external servers.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__proxy-settings-${process.pid}`;
const html = join(root, `${name}.html`),
  fixture = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-proxy-ui-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    fixture,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {GeneralSectionContent} from '../../../ui/src/settingsPageHelpers.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],fail:false};window.__proxy=state;
    const locale=new URLSearchParams(location.search).get('locale')||'zh-CN';
    const noop=async()=>{};
    const props:any={localePreference:locale,notificationEnabled:false,notificationSoundEnabled:false,closeToTrayOnWindows:false,receivePreviewUpdates:false,autoDownloadAndInstallUpdates:false,dataBaseDir:'',terminalInheritSystemProfile:true,terminalFontFamily:'',nativeSearchEnhancementsEnabled:true,defaultHomeDir:'/synthetic',platform:{},isDesktop:true,taskAutoArchiveEnabled:false,taskAutoArchiveOlderThanDays:7,messageStreamShowReasoning:true,messageStreamShowTodos:true,toolGroupingExploreEnabled:false,toolGroupingTerminalEnabled:false,toolGroupingChangesEnabled:false,zcodeInteractionBehavior:'queue'};
    for(const key of ['setLocalePreference','setNotificationEnabled','setNotificationSoundEnabled','onDataBaseDirChange','onSelectDataBaseDir','onTerminalInheritSystemProfileChange','onTerminalFontFamilyChange','onNativeSearchEnhancementsEnabledChange','onTaskAutoArchiveEnabledChange','onTaskAutoArchiveOlderThanDaysChange','onCloseToTrayOnWindowsChange','onReceivePreviewUpdatesChange','onAutoDownloadAndInstallUpdatesChange','onMessageStreamShowReasoningChange','onMessageStreamShowTodosChange','onToolGroupingExploreEnabledChange','onToolGroupingTerminalEnabledChange','onToolGroupingChangesEnabledChange','onZCodeInteractionBehaviorChange'])props[key]=noop;
    function Fixture(){const [value,setValue]=useState(localStorage.getItem('synthetic.proxy.domains')||'');state.theme=applyTheme;return <div className="min-h-screen bg-background text-foreground p-4"><GeneralSectionContent {...props} httpProxy="http://127.0.0.1:17890" httpProxyOnlyDomains={value} onHttpProxyOnlyDomainsChange={async(next:string)=>{state.calls.push({httpProxyOnlyDomains:next});if(state.fail){state.fail=false;throw new Error('synthetic save failure')}localStorage.setItem('synthetic.proxy.domains',next);setValue(next)}}/></div>}
    applyTheme('zai-light');createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale={locale as any}><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const locale of ["zh-CN", "en-US"]) {
    const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    const url = `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html?locale=${locale}`;
    await page.goto(url);
    const label = locale === "zh-CN" ? "仅这些域名使用代理" : "Only these domains use the proxy";
    const input = page.getByRole("textbox", { name: label, exact: true });
    const row = page.locator("div.border-t").filter({ has: input });
    const save = row.getByRole("button", {
      name: locale === "zh-CN" ? "保存" : "Save",
      exact: true,
    });
    await input.waitFor();
    assert.equal(await save.isDisabled(), true);
    await input.fill("https://github.com");
    assert.equal(await save.isDisabled(), true);
    await row.getByRole("alert").waitFor();
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.__proxy.calls), []);
    await input.fill("GitHub.COM, *.Example.com,github.com");
    await input.press("Enter");
    await page.waitForFunction(
      () => localStorage.getItem("synthetic.proxy.domains") === "github.com,*.example.com",
    );
    assert.equal(await input.inputValue(), "github.com,*.example.com");
    await page.reload();
    await input.waitFor();
    assert.equal(await input.inputValue(), "github.com,*.example.com");
    await page.evaluate(() => {
      window.__proxy.fail = true;
    });
    await input.fill("retry.test");
    await save.click();
    await row.getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), "retry.test");
    await save.click();
    await page.waitForFunction(
      () => localStorage.getItem("synthetic.proxy.domains") === "retry.test",
    );
    await input.fill("");
    await save.click();
    await page.waitForFunction(() => localStorage.getItem("synthetic.proxy.domains") === "");
    assert.equal((await page.evaluate(() => window.__proxy.calls)).at(-1).httpProxyOnlyDomains, "");
    await page.reload();
    await input.waitFor();
    assert.equal(await input.inputValue(), "");
    await input.fill("github.com,*.github.com,*.githubusercontent.com");
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((value) => window.__proxy.theme(value), theme);
        await row.scrollIntoViewIfNeeded();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
          `No overflow ${locale}/${width}/${theme}`,
        );
        await row.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Proxy domain settings E2E passed. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(fixture, { force: true })]);
}
