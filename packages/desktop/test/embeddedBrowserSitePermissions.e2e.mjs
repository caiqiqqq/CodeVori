// Requires the desktop Vite server at ZCODE_E2E_BASE_URL (default 5187).
// Uses an isolated Electron profile; does not connect to the user's app.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright-core";
import electronPath from "electron";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const renderer = join(repo, "packages/desktop/src/renderer");
const artifacts = await mkdtemp(join(tmpdir(), "site-permissions-e2e-"));
const name = `__site-permissions-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const guestHtml = join(renderer, `${name}-guest.html`);
const baseUrl = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187";
const preload = join(artifacts, "preload.cjs");
const main = join(artifacts, "main.cjs");
const storage = join(artifacts, "permissions.json");
let app;

try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    guestHtml,
    "<!doctype html><title>Permission test site</title><p>Isolated permission request site</p>",
  );
  await writeFile(
    moduleFile,
    `
import React, {useState, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {EmbeddedBrowserSitePermissionPrompt} from '../../../ui/src/browser-use/EmbeddedBrowserSitePermissionPrompt.tsx';
import {BrowserSitePermissions} from '../../../ui/src/settings/BrowserSitePermissions.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import '../../../ui/src/styles.css';
const platform=window.sitePermissionBridge;
function Harness(){
  const [guestId,setGuestId]=useState(0);
  const [manage,setManage]=useState(false);
  const view=useRef(null);
  return <div className="relative h-screen overflow-auto bg-background p-3 text-foreground" data-guest-id={guestId}>
    <button data-testid="request" onClick={()=>{window.permissionResult=null;view.current.executeJavaScript('Notification.requestPermission()', true).then(value=>window.permissionResult=value);}}>Request notifications</button>
    <button className="ml-4" data-testid="manage" onClick={()=>setManage(value=>!value)}>Manage</button>
    <webview ref={node=>{if(node && view.current!==node){view.current=node;node.addEventListener('dom-ready',()=>setGuestId(node.getWebContentsId()));}}}
      src=${JSON.stringify(`${baseUrl}/${name}-guest.html`)} partition="persist:site-permission-e2e" style={{height:240,width:'100%',marginTop:16}}/>
    <EmbeddedBrowserSitePermissionPrompt guestWebContentsId={guestId}/>
    {manage ? <BrowserSitePermissions/>:null}
  </div>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale="en-US"><Harness/></ZCodeIntlProvider></PlatformProvider>);
`,
  );
  await build({
    stdin: {
      contents: `
import {contextBridge,ipcRenderer} from 'electron';
import {PlatformChannels as C} from '@zcode/shared';
contextBridge.exposeInMainWorld('sitePermissionBridge',{
  onEmbeddedBrowserSitePermissionPrompt(handler){const listener=(_event,value)=>handler(value);ipcRenderer.on(C.EmbeddedBrowserSitePermissionPrompt,listener);return ()=>ipcRenderer.removeListener(C.EmbeddedBrowserSitePermissionPrompt,listener);},
  onEmbeddedBrowserSitePermissionClosed(handler){const listener=(_event,value)=>handler(value);ipcRenderer.on(C.EmbeddedBrowserSitePermissionClosed,listener);return ()=>ipcRenderer.removeListener(C.EmbeddedBrowserSitePermissionClosed,listener);},
  onEmbeddedBrowserSitePermissionsChanged(handler){ipcRenderer.on(C.EmbeddedBrowserSitePermissionsChanged,handler);return ()=>ipcRenderer.removeListener(C.EmbeddedBrowserSitePermissionsChanged,handler);},
  resolveEmbeddedBrowserSitePermissionPrompt(request){ipcRenderer.send(C.ResolveEmbeddedBrowserSitePermissionPrompt,request);},
  getEmbeddedBrowserSitePermissions(){return ipcRenderer.invoke(C.GetEmbeddedBrowserSitePermissions);},
  setEmbeddedBrowserSitePermission(request){return ipcRenderer.invoke(C.SetEmbeddedBrowserSitePermission,request);},
  resetEmbeddedBrowserSitePermission(origin){return ipcRenderer.invoke(C.ResetEmbeddedBrowserSitePermission,origin);},
  clearEmbeddedBrowserSitePermissions(){return ipcRenderer.invoke(C.ClearEmbeddedBrowserSitePermissions);},
});`,
      resolveDir: repo,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: preload,
    alias: { "@zcode/shared": join(repo, "packages/shared/src/index.ts") },
  });
  await build({
    stdin: {
      contents: `
import {app,BrowserWindow,webContents,session} from 'electron';
import {PlatformChannels} from '@zcode/shared';
import {installEmbeddedBrowserDeviceSelection} from './packages/desktop/src/main/embeddedBrowserDeviceSelection.ts';
import {installEmbeddedBrowserPermissionBaseline} from './packages/desktop/src/main/embeddedBrowserPermissionBaseline.ts';
import {createEmbeddedBrowserSitePermissionController} from './packages/desktop/src/main/embeddedBrowserSitePermissionController.ts';
import {createEmbeddedBrowserSitePermissionFile} from './packages/desktop/src/main/embeddedBrowserSitePermissionFile.ts';
import {registerEmbeddedBrowserSitePermissionIpc} from './packages/desktop/src/main/embeddedBrowserSitePermissionIpc.ts';
app.setPath('userData',${JSON.stringify(join(artifacts, "profile"))});
app.whenReady().then(async()=>{
 const controller=createEmbeddedBrowserSitePermissionController({...createEmbeddedBrowserSitePermissionFile(${JSON.stringify(storage)}),sendPrompt:(id,prompt)=>{const host=webContents.fromId(id);if(!host)return false;host.send(PlatformChannels.EmbeddedBrowserSitePermissionPrompt,prompt);return true;},onPromptClosed:(id,requestId)=>webContents.fromId(id)?.send(PlatformChannels.EmbeddedBrowserSitePermissionClosed,requestId),onChanged:()=>{for(const win of BrowserWindow.getAllWindows())win.webContents.send(PlatformChannels.EmbeddedBrowserSitePermissionsChanged);}});
 await controller.load();
 registerEmbeddedBrowserSitePermissionIpc(controller);
 installEmbeddedBrowserPermissionBaseline(session.fromPartition('persist:site-permission-e2e'),{info(){},warn(){}},controller);
 const browserSession=session.fromPartition('persist:site-permission-e2e');
 const selections=installEmbeddedBrowserDeviceSelection(browserSession,controller,{fromFrame:frame=>webContents.fromFrame(frame),getSources:async()=>[{id:'screen:test',name:'Test screen',thumbnail:{toDataURL:()=>''}}],warn(){}});
 app.on('web-contents-created',(_event,contents)=>selections.attachGuest(contents));
 globalThis.sitePermissionController=controller;
 const win=new BrowserWindow({width:1280,height:900,webPreferences:{preload:${JSON.stringify(preload)},sandbox:false,contextIsolation:true,webviewTag:true}});
 await win.loadURL(${JSON.stringify(`${baseUrl}/${name}.html`)});
});`,
      resolveDir: repo,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: main,
    alias: { "@zcode/shared": join(repo, "packages/shared/src/index.ts") },
  });

  app = await _electron.launch({ executablePath: electronPath, args: [main], timeout: 30_000 });
  let page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForFunction(
    () => Number(document.querySelector("[data-guest-id]")?.getAttribute("data-guest-id")) > 0,
  );
  // 使用真实 guest/host/IPC/React 选择器，原生设备枚举使用确定性的模拟设备。
  const guestId = await page.locator("[data-guest-id]").getAttribute("data-guest-id");
  await app.evaluate(({ webContents, session }, id) => {
    const guest = webContents.fromId(Number(id));
    globalThis.deviceResult = "pending";
    session
      .fromPartition("persist:site-permission-e2e")
      .emit(
        "select-usb-device",
        { preventDefault() {} },
        { frame: guest.mainFrame, deviceList: [{ deviceId: "usb:test", productName: "Test USB" }] },
        (value) => (globalThis.deviceResult = value),
      );
  }, guestId);
  const chooser = page.getByRole("dialog", { name: "Website permission request" });
  await chooser.getByRole("button", { name: "Test USB", exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.deviceResult), "usb:test");
  await app.evaluate(({ webContents }, id) => {
    const guest = webContents.fromId(Number(id));
    globalThis.deviceResult = "pending";
    guest.emit(
      "select-bluetooth-device",
      { preventDefault() {} },
      [{ deviceId: "bt:test", deviceName: "Test Bluetooth" }],
      (value) => (globalThis.deviceResult = value),
    );
    guest.emit(
      "select-bluetooth-device",
      { preventDefault() {} },
      [{ deviceId: "bt:new", deviceName: "New Bluetooth" }],
      () => {},
    );
  }, guestId);
  await chooser.getByRole("button", { name: "New Bluetooth", exact: true }).waitFor();
  assert.equal(
    await chooser.getByRole("button", { name: "Test Bluetooth", exact: true }).count(),
    0,
  );
  await page.screenshot({ path: join(artifacts, "device-chooser.png"), animations: "disabled" });
  await chooser.getByRole("button", { name: "New Bluetooth", exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.deviceResult), "bt:new");
  await page.getByTestId("request").click();
  let prompt = page.getByRole("dialog", { name: "Website permission request" });
  await prompt.waitFor();
  await prompt.getByText(new URL(baseUrl).origin, { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "permission-prompt.png") });
  await prompt.getByRole("button", { name: "Always allow", exact: true }).click();
  await page.waitForFunction(() => window.permissionResult === "granted");
  const persisted = JSON.parse(await readFile(storage, "utf8"));
  assert.equal(persisted[new URL(baseUrl).origin]?.notifications, "allow");

  // 重启同一个隔离 profile，验证磁盘授权恢复，而不是依赖 Main 内存缓存。
  await app.close();
  app = await _electron.launch({ executablePath: electronPath, args: [main], timeout: 30_000 });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForFunction(
    () => Number(document.querySelector("[data-guest-id]")?.getAttribute("data-guest-id")) > 0,
  );
  prompt = page.getByRole("dialog", { name: "Website permission request" });
  await page.getByTestId("request").click();
  await page.waitForFunction(() => window.permissionResult === "granted");
  assert.equal(await prompt.count(), 0);

  await page.getByTestId("manage").click();
  const settings = page.getByTestId("browser-site-permissions");
  await settings.locator("select").waitFor();
  await page.screenshot({ path: join(artifacts, "site-permissions-saved.png") });
  await settings.locator("select").selectOption("deny");
  await page.waitForFunction(
    () =>
      document.querySelector("select")?.value === "deny" &&
      !document.querySelector("select")?.disabled,
  );
  assert.equal(
    await app.evaluate(
      (_electron, origin) => globalThis.sitePermissionController.check(origin, "notifications"),
      new URL(baseUrl).origin,
    ),
    false,
  );
  await page.getByTestId("request").click();
  await page.waitForFunction(() => window.permissionResult === "denied");
  assert.equal(await prompt.count(), 0);
  await settings.getByRole("button", { name: "Reset all permissions", exact: true }).click();
  await settings.getByText("No saved website permissions.", { exact: false }).waitFor();
  assert.deepEqual(JSON.parse(await readFile(storage, "utf8")), {});

  await page.getByTestId("request").click();
  await prompt.waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(400, 800));
  await page.evaluate(() => document.documentElement.classList.add("dark", "theme-zai-dark"));
  const promptBounds = await prompt.boundingBox();
  assert.ok(promptBounds && promptBounds.x >= 0 && promptBounds.x + promptBounds.width <= 400);
  await page.screenshot({
    path: join(artifacts, "permission-prompt-narrow-dark.png"),
    animations: "disabled",
  });
  await prompt.getByRole("button", { name: "Deny this time", exact: true }).click();
  await page.waitForFunction(() => window.permissionResult === "denied");
  assert.deepEqual(JSON.parse(await readFile(storage, "utf8")), {});
  await page.getByTestId("request").click();
  await prompt.waitFor();
  await app.evaluate(() => globalThis.sitePermissionController.clear());
  await prompt.waitFor({ state: "detached" });
  await page.waitForFunction(() => window.permissionResult === "denied");
  await page.screenshot({ path: join(artifacts, "site-permissions-settings.png") });
  assert.deepEqual(pageErrors, []);
  console.log(
    `PASS: real Electron webview request → prompt → persist → restart → block → reset → deny; narrow dark layout. ${artifacts}`,
  );
} finally {
  await app?.close();
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(guestHtml, { force: true }),
  ]);
}
