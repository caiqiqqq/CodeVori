import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const fixtureName = `__open-cua-e2e-${process.pid}`;
const html = join(desktop, "src/renderer", `${fixtureName}.html`);
const moduleFile = join(desktop, "src/renderer", `${fixtureName}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-open-cua-ui-"));
let server;
let browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${fixtureName}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ComputerUseSection} from '../../../ui/src/settings/ComputerUseSection.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {Button} from '../../../ui/src/components/ui/button.tsx';
    import {createSettingsPageConfig,resolveSettingsSectionForPlatform} from '../../../ui/src/settings/settingsPageConfig.ts';
    import {consumeInitialSettingsSection,setPendingSettingsSectionIntent,writeLastSettingsSectionPreference} from '../../../ui/src/lib/settingsNavigation.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],enabled:false,permissionGranted:false,settings:{computerUseComposerEntryHidden:true},mode:'mac'};
    window.__cua=state;state.setTheme=applyTheme;
    const id='computer-use@zcode-plugins-official';
    const plugin=()=>({id,name:'computer-use',enabled:state.enabled,components:[],diagnostics:[]});
    const services:any={
      settingService:{get:async()=>state.settings,update:async(patch:any)=>{state.calls.push({op:'settings',patch});return Object.assign(state.settings,patch)}},
      pluginManagementService:{
        listPlugins:async()=>({plugins:[plugin()],diagnostics:[]}),
        getPluginsOverview:async()=>({marketplaces:[],availablePlugins:[],installedPlugins:[],restorableBuiltins:[],diagnostics:[]}),
        setPluginEnabled:async(params:any)=>{state.enabled=params.enabled;state.calls.push({op:'toggle',...params});return {enabled:state.enabled,plugin:plugin()}}
      },
      cuaPermissionService:{getStatus:async(path:string,identity:any,options:any)=>{state.calls.push({op:'status',path,options});return {available:true,grantOwner:'Example',accessibility:state.permissionGranted?'granted':'denied',screenRecording:state.permissionGranted?'granted':'denied',screenCaptureProbeOk:false}},restartHelper:async()=>{state.calls.push({op:'restart'});return {ok:true}}},
    };
    const platform:any={executeDesktopCommand:async()=>({kind:'supported'}),openCuaPermissionOnboarding:async()=>{state.calls.push({op:'onboarding'});return {success:false,canceled:true}},cancelCuaPermissionOnboarding:()=>{},onSettingsChanged:()=>()=>{}};
    function Fixture(){
      const [mode,setMode]=useState('mac');
      const [section,setSection]=useState('general');
      const {settingsSections}=createSettingsPageConfig({isDesktop:mode!=='web',isMacDesktop:mode==='mac'||mode==='remote',isWindowsDesktop:mode==='windows'});
      const activeSection=resolveSettingsSectionForPlatform(section,settingsSections);
      state.setMode=setMode;
      state.close=()=>setSection('general');
      state.reopen=()=>setSection(resolveSettingsSectionForPlatform(consumeInitialSettingsSection(),settingsSections));
      state.openFromComposer=()=>{setPendingSettingsSectionIntent('computerUse');state.reopen()};
      return <PlatformProvider platform={platform}><ServiceProvider services={services}><main className='min-h-dvh bg-background p-4 text-foreground'><div className='mx-auto max-w-3xl'>
        {settingsSections.some(section=>section.id==='computerUse')?<nav className='mb-4'><Button data-testid='cua-settings-nav' variant='ghost' onClick={()=>{writeLastSettingsSectionPreference('computerUse');state.reopen()}}>电脑控制</Button></nav>:null}
        {activeSection==='computerUse'?<ComputerUseSection key={mode} isDesktop={mode!=='web'} isMacDesktop={mode==='mac'||mode==='remote'} isWindowsDesktop={mode==='windows'} remoteSessionId={mode==='remote'?'fixture-remote':undefined} workspacePath='/synthetic/project'/>:null}
      </div></main></ServiceProvider></PlatformProvider>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><Fixture/></ZCodeIntlProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 800 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${fixtureName}.html`);
  const navigation = page.getByTestId("cua-settings-nav");
  try {
    await navigation.waitFor();
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "navigation-load-failure.png") });
    throw new Error(
      `Settings navigation failed to load: ${errors.join("; ") || (await page.locator("body").innerText())}. Artifacts: ${artifacts}`,
      { cause: error },
    );
  }
  assert.equal(await page.getByRole("switch").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__cua.calls), []);
  await navigation.click();
  const toggle = page.getByRole("switch").first();
  try {
    await toggle.waitFor();
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "load-failure.png") });
    throw new Error(
      `Settings fixture failed to load: ${errors.join("; ") || (await page.locator("body").innerText())}`,
      { cause: error },
    );
  }
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  assert.equal(
    await page.evaluate(() => window.__cua.settings.computerUseComposerEntryHidden),
    true,
  );
  for (const action of ["reopen", "openFromComposer"]) {
    await page.evaluate(() => window.__cua.close());
    await toggle.waitFor({ state: "detached" });
    await page.evaluate((action) => window.__cua[action](), action);
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
  }
  assert.equal(
    await page.evaluate(() =>
      window.__cua.calls.some((call) => ["toggle", "settings", "onboarding"].includes(call.op)),
    ),
    false,
  );
  await toggle.click();
  await page.waitForFunction(() => window.__cua.enabled === true);
  await page.getByText("辅助功能 (Accessibility)", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.__cua.calls.some((c) => c.op === "status" && c.options?.probeScreenCapture),
    ),
    false,
  );
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => window.__cua.setTheme(theme), theme);
    for (const width of [1120, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.screenshot({ path: join(artifacts, `mac-${theme}-${width}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  await page.setViewportSize({ width: 1120, height: 800 });
  const grant = page.getByRole("button", { name: "打开屏幕录制设置", exact: true });
  for (const expected of [1, 2]) {
    await grant.click();
    await page.waitForFunction(
      (count) => window.__cua.calls.filter((call) => call.op === "onboarding").length === count,
      expected,
    );
  }
  assert.equal(
    await page.evaluate(() =>
      window.__cua.calls.some(
        (call) => call.op === "restart" || call.options?.includeFunctionalProbes === true,
      ),
    ),
    false,
  );
  await page.evaluate(() => {
    window.__cua.permissionGranted = true;
  });
  await grant.click();
  await page.getByText("已授权", { exact: true }).first().waitFor();
  assert.equal(
    await page.evaluate(() => window.__cua.calls.filter((call) => call.op === "onboarding").length),
    2,
  );
  await toggle.click();
  await page.waitForFunction(() => window.__cua.enabled === false);
  for (const mode of ["windows", "linux", "remote"]) {
    const prior = await page.evaluate(() => window.__cua.calls.length);
    await page.evaluate((mode) => window.__cua.setMode(mode), mode);
    await page.getByText("当前环境暂不支持电脑控制", { exact: true }).waitFor();
    assert.equal(await page.getByRole("switch").count(), 0);
    assert.equal(await page.evaluate(() => window.__cua.calls.length), prior);
  }
  const priorWeb = await page.evaluate(() => window.__cua.calls.length);
  await page.evaluate(() => window.__cua.setMode("web"));
  await navigation.waitFor({ state: "detached" });
  await page.evaluate(() => window.__cua.openFromComposer());
  assert.equal(await page.getByRole("switch").count(), 0);
  assert.equal(await page.evaluate(() => window.__cua.calls.length), priorWeb);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: existing settings UI toggle, permissions preflight, platform gates, mobile widths and themes. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
