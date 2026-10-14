// Production settings/store/Desktop adapter; captured IPC only, no user settings or OS notifications.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__notification-focus-${process.pid}`;
const html = join(root, `${name}.html`);
const fixture = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-notification-focus-"));
let server;
let browser;
try {
  await writeFile(
    html,
    `<html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.__notifications=[];window.zcode={showTaskNotification(payload){window.__notifications.push(payload)}};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    fixture,
    `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {GeneralSectionContent} from '../../../ui/src/settingsPageHelpers.tsx';
    import {createZCodeStore} from '../../../ui/src/store/index.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import {createDesktopPlatform} from './src/desktopPlatform.ts';
    import '../../../ui/src/styles.css';
    const store=createZCodeStore({onMessage(){return {dispose(){}}},send(){}} as never);
    const platform=createDesktopPlatform({isLocalDevelopmentRuntime:true});
    const locale=new URLSearchParams(location.search).get('locale')||'zh-CN';
    const noop=async()=>{};
    const props:any={localePreference:locale,closeToTrayOnWindows:false,receivePreviewUpdates:false,autoDownloadAndInstallUpdates:false,dataBaseDir:'',terminalInheritSystemProfile:true,terminalFontFamily:'',nativeSearchEnhancementsEnabled:true,defaultHomeDir:'/synthetic',platform,isDesktop:true,taskAutoArchiveEnabled:false,taskAutoArchiveOlderThanDays:7,messageStreamShowReasoning:true,messageStreamShowTodos:true,toolGroupingExploreEnabled:false,toolGroupingTerminalEnabled:false,toolGroupingChangesEnabled:false,zcodeInteractionBehavior:'queue'};
    for(const key of ['setLocalePreference','onDataBaseDirChange','onSelectDataBaseDir','onTerminalInheritSystemProfileChange','onTerminalFontFamilyChange','onNativeSearchEnhancementsEnabledChange','onTaskAutoArchiveEnabledChange','onTaskAutoArchiveOlderThanDaysChange','onCloseToTrayOnWindowsChange','onReceivePreviewUpdatesChange','onAutoDownloadAndInstallUpdatesChange','onMessageStreamShowReasoningChange','onMessageStreamShowTodosChange','onToolGroupingExploreEnabledChange','onToolGroupingTerminalEnabledChange','onToolGroupingChangesEnabledChange','onZCodeInteractionBehaviorChange'])props[key]=noop;
    window.__fixture={theme:applyTheme,send(){platform.showTaskNotification({taskId:'synthetic',status:'completed',title:'Synthetic',body:'Review'})}};
    function Fixture(){const state=store();return <div className="min-h-screen bg-background text-foreground p-4"><GeneralSectionContent {...props} notificationEnabled={state.notificationEnabled} notificationSoundEnabled={state.notificationSoundEnabled} notificationOnlyWhenUnfocused={state.notificationOnlyWhenUnfocused} setNotificationEnabled={state.setNotificationEnabled} setNotificationSoundEnabled={state.setNotificationSoundEnabled} setNotificationOnlyWhenUnfocused={state.setNotificationOnlyWhenUnfocused}/></div>}
    applyTheme('zai-light');createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale={locale as any}><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  for (const locale of ["zh-CN", "en-US"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/${name}.html?locale=${locale}`);
    const label = locale === "zh-CN" ? "仅在窗口无焦点时通知" : "Notify only when unfocused";
    const control = page.getByRole("switch", { name: label, exact: true });
    const row = page.locator("div.border-t").filter({ has: control });
    const masterLabel = locale === "zh-CN" ? "任务通知" : "Task notifications";
    const master = page
      .locator("div.border-t")
      .filter({ has: page.getByText(masterLabel, { exact: true }) })
      .getByRole("switch");
    await control.waitFor();
    assert.equal(await control.getAttribute("aria-checked"), "true");
    await page.evaluate(() => window.__fixture.send());
    assert.equal(await page.evaluate(() => window.__notifications.at(-1).onlyWhenUnfocused), true);
    await control.click();
    assert.equal(await control.getAttribute("aria-checked"), "false");
    await page.evaluate(() => window.__fixture.send());
    assert.equal(await page.evaluate(() => window.__notifications.at(-1).onlyWhenUnfocused), false);
    await page.reload();
    await control.waitFor();
    assert.equal(await control.getAttribute("aria-checked"), "false");
    await page.evaluate(() => window.__fixture.send());
    assert.equal(await page.evaluate(() => window.__notifications.at(-1).onlyWhenUnfocused), false);
    await master.click();
    assert.equal(await control.isDisabled(), true);
    assert.equal(await control.getAttribute("aria-checked"), "false");
    await master.click();
    assert.equal(await control.isEnabled(), true);
    assert.equal(await control.getAttribute("aria-checked"), "false");
    await control.focus();
    await page.keyboard.press("Space");
    assert.equal(await control.getAttribute("aria-checked"), "true");
    await page.evaluate(() => window.__fixture.send());
    assert.equal(await page.evaluate(() => window.__notifications.at(-1).onlyWhenUnfocused), true);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((value) => window.__fixture.theme(value), theme);
        await row.scrollIntoViewIfNeeded();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        assert.ok(await row.locator(".min-w-0").evaluate((element) => element.clientWidth >= 150));
        await row.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  process.stdout.write(
    `PASS: Notification focus settings persistence/IPC/keyboard/master switch; screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(fixture, { force: true })]);
}
