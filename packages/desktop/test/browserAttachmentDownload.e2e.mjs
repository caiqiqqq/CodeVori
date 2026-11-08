// Requires the desktop Vite server at ZCODE_E2E_BASE_URL (default 5198).
// Uses real product window/webview/IPC/React code with isolated profile and local attachments.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { PRODUCT_EMBEDDED_BROWSER_PARTITION } from "@zcode/shared/product-brand";
import { _electron } from "playwright-core";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), "browser-attachment-e2e-"));
const renderer = join(repo, "packages/desktop/src/renderer");
const name = `__attachment-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const baseUrl = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5198";
const electronPath =
  process.env.ZCODE_ELECTRON_TEST_BINARY ?? createRequire(import.meta.url)("electron");
let downloads = 0;
let app;
const server = createServer((req, res) => {
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/download" });
    res.end();
  } else if (req.url === "/download") {
    downloads++;
    res.writeHead(200, {
      "Content-Disposition": 'attachment; filename="fixture.txt"',
      "Content-Type": "application/octet-stream",
    });
    res.end("isolated attachment");
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      '<!doctype html><title>Attachment fixture</title><a id="direct" href="/download">Download</a><a id="redirect" href="/redirect">Redirect download</a>',
    );
  }
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/page`;
  await mkdir(join(artifacts, "main"));
  await mkdir(join(artifacts, "preload"));
  const preload = join(artifacts, "preload/host.cjs");
  const main = join(artifacts, "main/test.cjs");
  await writeFile(join(artifacts, "preload/embeddedBrowserJavaScriptDialog.cjs"), "");
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UnifiedBrowserView} from '../../../ui/src/browser-use/UnifiedBrowserView.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
globalThis.__ZCODE_RENDERER_DISABLE_LOGGING__=true;
function Fixture(){
 const [url,setUrl]=useState(${JSON.stringify(pageUrl)});
 const [generation,setGeneration]=useState(0);
 window.__attachment={reopen:()=>setGeneration(value=>value+1),getUrl:()=>url};
 return <div style={{height:'100vh'}}><UnifiedBrowserView key={generation} browserKey="fixture" isVisible initialUrl={url} onUrlChange={setUrl}/></div>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={window.attachmentBridge}><ZCodeIntlProvider initialLocale="en-US"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
`,
  );
  const alias = { "@zcode/shared": join(repo, "packages/shared/src/index.ts") };
  await build({
    stdin: {
      contents: `
const {contextBridge,ipcRenderer}=require('electron');
import {PlatformChannels as C} from '@zcode/shared';
contextBridge.exposeInMainWorld('attachmentBridge',{
 isMacOS:true,isWindows:false,isLinux:false,isWeb:false,
 browserViewLoadUrl:request=>ipcRenderer.invoke(C.BrowserViewLoadUrl,request),
 onBrowserViewDownloadStarted(handler){const listener=(_event,value)=>handler(value);ipcRenderer.on(C.BrowserViewDownloadStarted,listener);return ()=>ipcRenderer.removeListener(C.BrowserViewDownloadStarted,listener);},
});`,
      resolveDir: repo,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: preload,
    alias,
  });
  await build({
    stdin: {
      contents: `
import {app,session} from 'electron';
import {join} from 'node:path';
import {createBrowserWindow} from './packages/desktop/src/main/desktopWindowChrome.ts';
import {installBrowserLocalPreview} from './packages/desktop/src/main/browser-local-preview/index.ts';
app.setPath('userData',${JSON.stringify(join(artifacts, "profile"))});
app.whenReady().then(()=>{
 const browserSession=session.fromPartition(${JSON.stringify(PRODUCT_EMBEDDED_BROWSER_PARTITION)});
 installBrowserLocalPreview(browserSession);
 browserSession.on('will-download',(_event,item)=>item.setSavePath(join(${JSON.stringify(artifacts)},'download-'+Date.now()+'.txt')));
 createBrowserWindow({iconPath:'',preloadPath:${JSON.stringify(preload)},logger:{warn:console.warn}});
});`,
      resolveDir: repo,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: main,
    alias,
    define: { "import.meta.dirname": JSON.stringify(join(artifacts, "main")) },
    plugins: [
      {
        name: "isolate-host-startup",
        setup(builder) {
          builder.onResolve({ filter: /\/desktopHostProcess\.js$/ }, () => ({
            path: "host-startup",
            namespace: "test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents: `export function loadWindow(win){return win.loadURL(${JSON.stringify(`${baseUrl}/${name}.html`)})}`,
          }));
        },
      },
    ],
  });
  app = await _electron.launch({ executablePath: electronPath, args: [main], timeout: 30000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = () =>
    page.waitForFunction((url) => {
      const view = document.querySelector("webview");
      try {
        return view?.getURL() === url && window.__attachment.getUrl() === url;
      } catch {
        return false;
      }
    }, pageUrl);
  await ready();
  for (const link of ["direct", "redirect", "address"]) {
    const before = downloads;
    await app.evaluate(({ session }, partition) => {
      globalThis.attachmentCompletion = new Promise((resolve) => {
        session.fromPartition(partition).once("will-download", (_event, item) => {
          item.once("done", (_doneEvent, state) => resolve(state));
        });
      });
    }, PRODUCT_EMBEDDED_BROWSER_PARTITION);
    if (link === "address") {
      const input = page.locator('[data-testid="browser-address-input"]');
      await input.fill(pageUrl.replace("/page", "/redirect"));
      await input.press("Enter");
    } else {
      await page.evaluate(
        (id) =>
          document
            .querySelector("webview")
            .executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`),
        link,
      );
    }
    assert.equal(await app.evaluate(() => globalThis.attachmentCompletion), "completed");
    await page.waitForFunction(() => document.querySelector("webview")?.isLoading() === false);
    await ready();
    assert.equal(downloads, before + 1);
    assert.equal(await page.locator('[data-testid="browser-load-error"]').count(), 0);
    const previousId = await page.evaluate(() =>
      document.querySelector("webview").getWebContentsId(),
    );
    await page.evaluate(() => window.__attachment.reopen());
    await page.waitForFunction((id) => {
      try {
        return document.querySelector("webview").getWebContentsId() !== id;
      } catch {
        return false;
      }
    }, previousId);
    await ready();
    assert.equal(downloads, before + 1, "reopening must not download the attachment again");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Browser attachments: direct/redirected links and address navigation preserve page URL; real guest recreation does not repeat downloads.",
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(artifacts, { recursive: true, force: true }),
  ]);
}
