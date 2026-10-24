// Real SettingsPage, synthetic native platform. No tailnet enrollment or real user credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__device-bridge-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-device-settings-"));
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
    import {ConfirmDialogHost} from '../../../ui/src/ConfirmDialog.tsx';
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
    const state:any={calls:[],fail:false,hold:false,snapshot:{binaryPath:'/synthetic/device-bridge',phase:'stopped',backendState:'Stopped',canLogin:false,nodeId:'',dnsName:'',loginName:'',tailnet:'',exposing:false,managementConfigured:false,peers:[]}};
    window.__devices=state;state.setTheme=applyTheme;state.intent=setPendingSettingsSectionIntent;
    state.authorize=()=>Object.assign(state.snapshot,{backendState:'Running',canLogin:false,nodeId:'mac',dnsName:'mac.example.ts.net',loginName:'synthetic@example.test',tailnet:'synthetic',peers:[{nodeId:'windows',name:'Windows workstation '+ 'long-name-'.repeat(12),os:'windows',online:true,connected:false,allowed:false},{nodeId:'offline',name:'Offline workstation',os:'windows',online:false,connected:false,allowed:false}]});
    const platform:any={
      openExternal:(url:string)=>{(state.externalUrls??=[]).push(url)},
      getDeviceBridgeState:async()=>structuredClone(state.snapshot),
      executeDeviceBridgeCommand:async(command:any)=>{
        state.calls.push(command);if(state.hold){state.hold=false;await new Promise(resolve=>state.release=resolve)}
        if(command.action==='start' && state.startError){
          Object.assign(state.snapshot,{phase:'error',error:state.startError});
          throw new Error("Error invoking remote method 'zcode:execute-device-bridge-command': Error: "+state.startError);
        }
        if(state.fail){state.fail=false;throw new Error(state.failCode || 'Synthetic device failure')}
        const s=state.snapshot,p=s.peers.find((p:any)=>p.nodeId===command.nodeId);
        switch(command.action){
          case 'configure-management':s.managementConfigured=true;break;
          case 'clear-management':s.managementConfigured=false;break;
          case 'remove':s.peers=s.peers.filter((p:any)=>p.nodeId!==command.nodeId);break;
          case 'configure':s.binaryPath=command.binaryPath;s.phase='stopped';delete s.error;break;
          case 'start':Object.assign(s,{phase:'running',backendState:'NeedsLogin',canLogin:true});delete s.error;break;
          case 'connect':Object.assign(p,{connected:true,toolCount:7,checkedAt:'2026-10-22T00:00:00Z'});break;
          case 'disconnect':p.connected=false;delete p.toolCount;delete p.checkedAt;break;
          case 'authorize':p.allowed=command.allowed;s.exposing=p.allowed;break;
          case 'logout':case 'stop':Object.assign(s,{phase:'stopped',backendState:'Stopped',canLogin:false,loginName:'',dnsName:'',peers:[]});break;
        }
        return structuredClone(s);
      },
      selectFile:async()=>'/synthetic/replacement-device-bridge',
      onSettingsChanged:()=>()=>{},selectDirectory:async()=>null,
    };
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={settingService:{get:async()=>({})},systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},broadcastService:broadcast};
    function Fixture(){
      const [mode,setMode]=useState('desktop'),[locale,setLocale]=useState('zh-CN'),[generation,setGeneration]=useState(0);
      state.setMode=setMode;state.setLocale=setLocale;state.remount=()=>setGeneration(v=>v+1);
      return <PlatformProvider platform={mode==='desktop'?platform:{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider><ConfirmDialogHost/><SettingsPage key={mode+generation} isDesktop={mode==='desktop'} isMacDesktop={mode==='desktop'}/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>
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
  const navigation = page.getByRole("button", { name: /^(设备与连接|Devices & connections)$/ });
  const general = page.getByRole("button", { name: /^(常规|General)$/ });
  const panel = page.getByTestId("device-bridge-settings");
  const ready = () =>
    page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="device-bridge-settings"]')
          ?.getAttribute("aria-busy") === "false",
    );
  await navigation.waitFor();
  assert.equal(await panel.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__devices.calls), []);
  await navigation.click();
  await ready();
  const settingsUrl = page.url();
  await panel.getByTestId("device-bridge-management-get-key").click();
  assert.deepEqual(await page.evaluate(() => window.__devices.externalUrls), [
    "https://console.tailscale.com/admin/settings/keys",
  ]);
  assert.equal(page.url(), settingsUrl);
  assert.equal(await navigation.getAttribute("aria-current"), "page");
  const failures = [
    ["device_bridge_component_missing", "未找到连接组件", "was not found"],
    ["device_bridge_component_not_executable", "没有执行权限", "cannot be executed"],
    ["device_bridge_start_failed", "启动失败", "could not start"],
    ["device_bridge_process_closed", "意外退出", "exited unexpectedly"],
    ["synthetic-private-token-and-auth-url", "连接操作未完成", "operation did not complete"],
  ];
  for (const [locale, language] of [
    ["zh-CN", 1],
    ["en-US", 2],
  ]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    for (const failure of failures) {
      await page.evaluate((code) => {
        window.__devices.startError = code;
      }, failure[0]);
      await panel.getByTestId("device-bridge-start").click();
      await ready();
      const alert = panel.getByRole("alert");
      assert.ok((await alert.textContent()).includes(failure[language]));
      assert.ok(!(await alert.textContent()).includes("synthetic-private"));
      await panel.getByTestId("device-bridge-refresh").click();
      await ready();
      assert.ok((await alert.textContent()).includes(failure[language]));
      await general.click();
      await navigation.click();
      await ready();
      assert.ok((await panel.getByRole("alert").textContent()).includes(failure[language]));
      await page.evaluate(() => {
        window.__devices.startError = null;
      });
      await panel.getByTestId("device-bridge-select-component").click();
      await ready();
      assert.equal(await panel.getByRole("alert").count(), 0);
    }
  }
  // 成功重试也必须清除 Main 的错误投影和 hook 的暂态错误。
  await page.evaluate(() => {
    window.__devices.startError = "device_bridge_component_missing";
  });
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  await page.evaluate(() => {
    window.__devices.startError = null;
  });
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  assert.equal(await panel.getByRole("alert").count(), 0);
  await panel.getByTestId("device-bridge-stop").click();
  await ready();
  await panel.getByTestId("device-bridge-select-component").click();
  await ready();
  assert.ok((await panel.textContent()).includes("/synthetic/replacement-device-bridge"));
  await panel.getByTestId("device-bridge-start").click();
  await ready();
  await panel.getByTestId("device-bridge-login").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.calls.at(-1).action), "open-login");
  assert.equal(await panel.getByTestId("device-bridge-select-component").isDisabled(), true);
  await page.evaluate(() => window.__devices.authorize());
  await panel.getByTestId("device-bridge-refresh").click();
  await ready();
  assert.equal(
    await panel.getByTestId("device-bridge-account").textContent(),
    "synthetic@example.test",
  );
  assert.equal(await panel.getByTestId("device-bridge-connect-offline").isDisabled(), true);
  assert.equal(await panel.getByTestId("device-bridge-remove-windows").isDisabled(), true);
  const keyInput = panel.getByTestId("device-bridge-management-key");
  assert.equal(await keyInput.getAttribute("type"), "password");
  await keyInput.fill("synthetic-session-key");
  await panel.getByTestId("device-bridge-management-get-key").click();
  assert.equal(await keyInput.inputValue(), "synthetic-session-key");
  assert.deepEqual(await page.evaluate(() => window.__devices.externalUrls), [
    "https://console.tailscale.com/admin/settings/keys",
    "https://console.tailscale.com/admin/settings/keys",
  ]);
  await panel.getByTestId("device-bridge-management-save").click();
  await ready();
  assert.equal(await keyInput.inputValue(), "");
  await panel.getByTestId("device-bridge-remove-offline").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok((await dialog.textContent()).includes("Offline workstation"));
  assert.ok((await dialog.textContent()).includes("offline"));
  await dialog.getByRole("button", { name: /Cancel|取消/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__devices.calls.some((c) => c.action === "remove")),
    false,
  );
  await panel.getByTestId("device-bridge-remove-offline").click();
  await dialog.getByRole("button", { name: /Remove from network|从网络移除/ }).click();
  await ready();
  await panel.getByTestId("device-bridge-peer-offline").waitFor({ state: "detached" });
  await panel.getByTestId("device-bridge-management-clear").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-remove-windows").isDisabled(), true);
  await keyInput.fill("synthetic-session-key");
  await panel.getByTestId("device-bridge-management-save").click();
  await ready();
  await page.evaluate(() => {
    window.__devices.fail = true;
    window.__devices.failCode = "device_bridge_management_forbidden";
  });
  await panel.getByTestId("device-bridge-remove-windows").click();
  await dialog.getByRole("button", { name: /Remove from network|从网络移除/ }).click();
  await ready();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByTestId("device-bridge-peer-windows").count(), 1);
  assert.match(await panel.getByRole("alert").textContent(), /cannot delete|没有删除/);
  await page.evaluate(() => {
    delete window.__devices.failCode;
  });
  const connect = panel.getByTestId("device-bridge-connect-windows");
  await page.evaluate(() => {
    window.__devices.fail = true;
  });
  await connect.click();
  await ready();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByTestId("device-bridge-check-windows").count(), 0);
  await page.evaluate(() => {
    window.__devices.hold = true;
  });
  await connect.click();
  await page.waitForFunction(() => Boolean(window.__devices.release));
  assert.equal(await connect.isDisabled(), true);
  assert.equal(await panel.getByTestId("device-bridge-authorize-windows").isDisabled(), true);
  await page.evaluate(() => window.__devices.release());
  await ready();
  assert.equal(await panel.getByRole("alert").count(), 0);
  assert.ok((await panel.getByTestId("device-bridge-check-result").textContent()).includes("7"));
  await panel.getByTestId("device-bridge-authorize-windows").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].allowed), true);
  await panel.getByTestId("device-bridge-authorize-windows").click();
  await ready();
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].allowed), false);
  await general.click();
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__devices.snapshot.peers[0].connected), true);
  await navigation.click();
  await ready();
  await panel.getByTestId("device-bridge-check-windows").click();
  await ready();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__devices.setTheme(theme), theme);
      for (const width of [1280, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "Settings must fit viewport",
        );
        const bounds = await panel.boundingBox();
        for (const button of await panel.getByRole("button").all()) {
          const box = await button.boundingBox();
          assert.ok(
            box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1,
            `${locale}/${theme}/${width}: ${await button.textContent()} must stay inside panel`,
          );
        }
        await panel.getByTestId("device-bridge-management-key").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(artifacts, `${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
  }
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__devices.setLocale(locale), locale);
    await ready();
    await page.setViewportSize({ width: 320, height: 900 });
    await panel.getByTestId("device-bridge-remove-windows").click();
    await dialog.waitFor();
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "Long device name must fit confirmation",
    );
    await page.screenshot({
      path: join(artifacts, `${locale}-removal-confirmation-320.png`),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: /Cancel|取消/ }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  await panel.getByTestId("device-bridge-connect-windows").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-check-result").count(), 0);
  await page.evaluate(() => window.__devices.remount());
  await ready();
  assert.equal(await navigation.getAttribute("aria-current"), "page");
  await panel.getByTestId("device-bridge-logout").click();
  await ready();
  assert.equal(await panel.getByTestId("device-bridge-account").count(), 0);
  await panel.getByTestId("device-bridge-start").waitFor();
  await page.evaluate(() => window.__devices.setMode("web"));
  await panel.waitFor({ state: "detached" });
  assert.equal(await navigation.count(), 0);
  assert.equal(await general.getAttribute("aria-current"), "page");
  await page.evaluate(() => window.__devices.intent("devices"));
  assert.equal(await general.getAttribute("aria-current"), "page");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real SettingsPage; specific safe startup errors, refresh/remount/retry recovery, component selection, login, health failure/retry, pending controls, management key lifecycle, cancel/confirm removal and failure, explicit grant/revoke, page lifetime, disconnect/logout, capability gating, zh/en, light/dark, 320/375/1280px. Screenshots: ${artifacts}\n`,
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
