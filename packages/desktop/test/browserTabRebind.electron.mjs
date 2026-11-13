// Isolated Electron + real side pane/BrowserGuestManager. Requires the desktop Vite server.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron } from "playwright-core";
import electronPath from "electron";
import { browserTabRebindFixture } from "../../ui/test/browserTabRebindFixture.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "browser-rebind-"));
const renderer = join(repo, "packages/desktop/src/renderer");
const name = `__browser-rebind-${process.pid}`;
const files = [join(renderer, `${name}.html`), join(renderer, `${name}.tsx`)];
const origin = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187";
const preload = join(directory, "preload.cjs");
const main = join(directory, "main.mjs");
const fixtureUrl = pathToFileURL(join(directory, "index.html")).href;
let app;
try {
  await Promise.all([
    writeFile(
      files[0],
      `<!doctype html><html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(files[1], browserTabRebindFixture),
    writeFile(
      join(directory, "index.html"),
      '<!doctype html><title>Original preview</title><input id="draft"><a href="second.html">Next</a>',
    ),
    writeFile(
      join(directory, "second.html"),
      "<!doctype html><title>Second preview</title><h1>Second page</h1>",
    ),
  ]);
  const bundle = async (contents, outfile) =>
    build({
      stdin: { contents, resolveDir: repo },
      bundle: true,
      platform: "node",
      format: outfile === main ? "esm" : "cjs",
      external: ["electron"],
      outfile,
      nodePaths: [join(repo, "packages/desktop/node_modules"), join(repo, "node_modules")],
      ...(outfile === main
        ? {
            banner: {
              js: "import {createRequire as fixtureRequire} from 'node:module'; import {fileURLToPath as fixtureFilePath} from 'node:url'; import {dirname as fixtureDirname} from 'node:path'; const require=fixtureRequire(import.meta.url); const __filename=fixtureFilePath(import.meta.url); const __dirname=fixtureDirname(__filename);",
            },
          }
        : {}),
    });
  await bundle(
    `
import {contextBridge,ipcRenderer} from 'electron';
import {PlatformChannels as C} from '@zcode/shared';
contextBridge.exposeInMainWorld('browserFixtureUrl',${JSON.stringify(fixtureUrl)});
contextBridge.exposeInMainWorld('browserRebindBridge',{
 isWeb:false,isMacOS:false,isWindows:false,isLinux:true,
 onBrowserViewReady(callback){const listener=(_event,payload)=>callback(payload);ipcRenderer.on('fixture:ready',listener);return()=>ipcRenderer.removeListener('fixture:ready',listener)},
 browserViewAttachGuest:request=>ipcRenderer.invoke('fixture:attach',request),
 browserViewDetachGuest:request=>ipcRenderer.invoke('fixture:detach',request),
 browserViewCloseTab:request=>ipcRenderer.invoke('fixture:close',request),
 browserViewLoadUrl:request=>ipcRenderer.invoke(C.BrowserViewLoadUrl,request),
});`,
    preload,
  );
  await bundle(
    `
import {app,BrowserWindow,ipcMain,protocol,session} from 'electron';
import {PRODUCT_EMBEDDED_BROWSER_PARTITION} from '@zcode/shared/product-brand';
import {BrowserGuestManager} from './packages/desktop/src/main/browserView/browserGuestManager.ts';
import {BROWSER_LOCAL_PREVIEW_PRIVILEGES,installBrowserLocalPreview} from './packages/desktop/src/main/browser-local-preview/index.ts';
app.setPath('userData',${JSON.stringify(join(directory, "profile"))});
protocol.registerSchemesAsPrivileged([BROWSER_LOCAL_PREVIEW_PRIVILEGES]);
app.whenReady().then(async()=>{
 const logs=[],attachCalls=[];
 const manager=new BrowserGuestManager(message=>logs.push(message),1000,undefined,(tabId,owner)=>{
  BrowserWindow.fromId(owner.windowId)?.webContents.send('fixture:ready',{...owner,tabId});
 });
 installBrowserLocalPreview(session.fromPartition(PRODUCT_EMBEDDED_BROWSER_PARTITION));
 const win=new BrowserWindow({width:1280,height:900,webPreferences:{preload:${JSON.stringify(preload)},sandbox:false,contextIsolation:true,webviewTag:true}});
 // Mirror the product guest preferences; subframe Node integration without the
 // product sandbox settings changes Electron's process and teardown behavior.
 win.webContents.on('will-attach-webview',(_event,preferences)=>{preferences.sandbox=true;preferences.contextIsolation=true;preferences.nodeIntegration=false;preferences.nodeIntegrationInSubFrames=true;});
 ipcMain.handle('fixture:attach',(_event,request)=>{attachCalls.push(request);return manager.attachGuest(request.key,request.webContentsId,{...request,windowId:win.id})});
 ipcMain.handle('fixture:detach',(_event,request)=>manager.detachGuestBeforeReplacement(request.key,request.webContentsId,win.id));
 ipcMain.handle('fixture:close',(_event,request)=>manager.closeTabFromRenderer({...request,windowId:win.id}));
 globalThis.fixture={manager,win,logs,attachCalls};
 await win.loadURL(${JSON.stringify(`${origin}/${name}.html`)});
});`,
    main,
  );
  app = await _electron.launch({ executablePath: electronPath, args: [main], timeout: 30_000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  const errors = [];
  let phase = "initial navigation";
  page.on("pageerror", (error) => errors.push({ phase, stack: error.stack }));
  const state = () =>
    page.evaluate(() => ({
      collapsed: window.__browserRebind.panels.isSidePaneCollapsed,
      tabs: window.__browserRebind.panels.sidePaneState?.tabs ?? [],
      workspace: window.__browserRebind.workspace,
    }));
  const waitForGuestUrl = async (fragment) => {
    try {
      await page.waitForFunction((fragment) => {
        // Electron methods throw until the remounted guest has emitted dom-ready.
        try {
          return document.querySelector("webview")?.getURL().includes(fragment);
        } catch {
          return false;
        }
      }, fragment);
    } catch (error) {
      console.error({
        phase,
        errors,
        state: await state(),
        main: await app.evaluate(() => ({
          logs: globalThis.fixture.logs,
          attachCalls: globalThis.fixture.attachCalls,
        })),
        views: await page.locator("webview").evaluateAll((views) =>
          views.map((view) => {
            try {
              return { url: view.getURL(), id: view.getWebContentsId() };
            } catch (error) {
              return { error: error.message };
            }
          }),
        ),
      });
      throw error;
    }
  };
  const sendReady = async (payload) => {
    const previous = await page.evaluate(() => window.__browserReadyCount ?? 0);
    await app.evaluate((_electron, payload) => {
      globalThis.fixture.win.webContents.send("fixture:ready", payload);
    }, payload);
    await page.waitForFunction((previous) => window.__browserReadyCount > previous, previous);
  };
  await page.getByTestId("open").click();
  await waitForGuestUrl("index.html");
  const committedPreviewUrl = await page.locator("webview").evaluate((view) => view.getURL());
  const original = (await state()).tabs[0];
  const payload = {
    tabId: original.id,
    workspaceKey: "/fixture/project-a",
    sessionId: "session-a",
    browserId: "unclaimed-iab",
    browserGeneration: 0,
  };
  const guestId = await page.locator("webview").evaluate((view) => view.getWebContentsId());
  await page
    .locator("webview")
    .evaluate((view) =>
      view.executeJavaScript("document.querySelector('#draft').value='kept draft'"),
    );
  await page.getByTestId("toggle").click();
  await page.getByTestId("session").click();
  await sendReady(payload);
  await page.getByTestId("session").click();
  await sendReady(payload);
  await page.waitForFunction(() => window.__browserRebind.panels.sidePaneState.tabs.length === 1);
  assert.equal((await state()).collapsed, true);
  assert.equal((await state()).tabs[0].id, original.id);
  await page.getByTestId("toggle").click();
  assert.equal(await page.locator("webview").evaluate((view) => view.getWebContentsId()), guestId);
  assert.equal(
    await page
      .locator("webview")
      .evaluate((view) => view.executeJavaScript("document.querySelector('#draft').value")),
    "kept draft",
  );

  // Transient workspace props must never reassign the old native guest's owner.
  phase = "workspace switch";
  await page.getByTestId("toggle").click();
  await page.getByTestId("workspace").click();
  await page.waitForFunction(
    () =>
      window.__browserRebind.workspace.endsWith("-b") &&
      !window.__browserRebind.panels.sidePaneState,
  );
  await sendReady(payload);
  assert.equal((await state()).tabs.length, 0);
  await page.getByTestId("workspace").click();
  await page.waitForFunction(() => window.__browserRebind.panels.sidePaneState?.tabs.length === 1);
  assert.equal((await state()).collapsed, true);
  await page.getByTestId("toggle").click();
  await waitForGuestUrl("index.html");
  phase = "navigation history";
  await page
    .locator("webview")
    .evaluate((view) => view.executeJavaScript("document.querySelector('a').click()"));
  await waitForGuestUrl("second.html");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await waitForGuestUrl("index.html");
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await waitForGuestUrl("second.html");
  await page.locator("webview").evaluate((view) => {
    window.__refreshCompleted = false;
    view.addEventListener(
      "did-stop-loading",
      () => {
        window.__refreshCompleted = true;
      },
      { once: true },
    );
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => window.__refreshCompleted);
  assert.equal(await page.locator("webview").evaluate((view) => view.getTitle()), "Second preview");
  phase = "close";
  await page.getByTestId("toggle").click();
  await page.evaluate(
    (id) => window.__browserRebind.panels.handleCloseSidePaneTab(id),
    original.id,
  );
  await page.waitForFunction(() => !window.__browserRebind.panels.sidePaneState?.tabs.length);
  await sendReady(payload);
  assert.equal((await state()).tabs.length, 0);

  phase = "background workspace registry";
  await page.getByTestId("workspace").click();
  await page.waitForFunction(() => window.__browserRebind.workspace.endsWith("-b"));
  await sendReady({ ...payload, tabId: "background-controlled", browserId: "iab:fixture" });
  assert.equal((await state()).tabs.length, 0);
  assert.equal((await state()).collapsed, true);
  await page.getByTestId("workspace").click();
  await page.waitForFunction(() => window.__browserRebind.panels.sidePaneState?.tabs.length === 1);
  assert.equal((await state()).tabs[0].tabId, "background-controlled");
  assert.equal((await state()).collapsed, true);
  await waitForGuestUrl("about:blank");
  await page.evaluate(() =>
    window.__browserRebind.panels.handleCloseSidePaneTab("browser-use:background-controlled"),
  );
  await page.waitForFunction(() => !window.__browserRebind.panels.sidePaneState?.tabs.length);

  phase = "Main navigation recovery";
  await page.evaluate(() => window.__browserRebind.showMainRestore());
  await waitForGuestUrl("about:blank");
  const restoredGuestId = await page.locator("webview").evaluate((view) => view.getWebContentsId());
  await app.evaluate(
    async ({ webContents }, { id, url }) => {
      await webContents.fromId(id).loadURL(url);
    },
    { id: restoredGuestId, url: committedPreviewUrl },
  );
  await waitForGuestUrl("index.html");
  await page.waitForFunction(() => {
    const style = getComputedStyle(document.querySelector("webview"));
    return style.display !== "none" && style.visibility === "visible";
  });
  const mismatch = await app.evaluate(() =>
    globalThis.fixture.logs.filter((line) =>
      /workspace-mismatch|session-mismatch|remote-session-mismatch/.test(line),
    ),
  );
  assert.deepEqual(mismatch, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: native HTML preview, collapse/session/workspace switches, Ready replay, single shell, draft retained within workspace, back/forward/refresh, close and stale Ready, background Ready routing, visible Main navigation recovery; no owner mismatch.",
  );
} finally {
  await app?.close();
  await Promise.all(files.map((path) => rm(path, { force: true })));
  await rm(directory, { recursive: true, force: true });
}
