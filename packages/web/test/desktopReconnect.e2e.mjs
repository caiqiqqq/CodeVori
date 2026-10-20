// Real Web bootstrap and recovery UI. Synthetic service transport never accesses user sessions.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const name = `__reconnect-${process.pid}`;
const html = join(root, `${name}.html`);
let server, browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/src/main.tsx"></script>`,
  );
  server = await createServer({
    configFile: false,
    root,
    logLevel: "warn",
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      alias: [
        { find: /^@zcode\/ui\/styles.css$/, replacement: "\0empty" },
        { find: /^@zcode\/ui$/, replacement: "\0ui" },
        { find: /^@zcode\/client$/, replacement: "\0client" },
        { find: /^@zcode\/shared$/, replacement: "\0shared" },
      ],
    },
    plugins: [
      {
        name: "synthetic-boundaries",
        enforce: "pre",
        resolveId(id, importer) {
          if (id.startsWith("\0")) return id;
          if (
            importer?.endsWith("/src/main.tsx") &&
            id.startsWith("./") &&
            !/DesktopReconnectScreen|desktopWindowConnection/.test(id)
          )
            return "\0helpers";
        },
        load(id) {
          if (id === "\0empty") return "";
          if (id === "\0shared") return `export const PRODUCT_NAME='CodeVori';`;
          if (id === "\0helpers")
            return `
        export const createWebAuthService=()=>({});export const isConversationSharePath=()=>false;
        export const WEB_DEFAULT_THEME='zai-dark',resolveWebInitialTheme=()=> 'zai-dark';
        export const WebCallbackPage=()=>null,WEB_ZAI_OAUTH_CONFIG={},resolveWebAuthDevReturnTo=()=>'',parseOAuthState=()=>null,resolveSafeAppReturnTo=()=>null,resolveWebCommunityUrl=()=>null,resolveWebHelpConfig=()=>null,ConversationShareLandingLoader=()=>null,ConversationShareLandingStatus=()=>null,ConversationSharePreviewClient=class{},resolveConversationShareRouteLocale=()=> 'zh-CN',resolveConversationShareCodeFromPath=()=>null;`;
          if (id === "\0ui")
            return `import React,{useEffect} from 'react';
        export const Root=props=>{useEffect(()=>{window.__web.mounts++;window.__web.props=props},[]);return React.createElement('input',{'aria-label':'draft'})};
        export const AppErrorBoundary=({children})=>children,ZCodeIntlProvider=AppErrorBoundary;
        export const generateMobileDeviceFingerprint=()=> 'synthetic',setStreamClientId=()=>{},isTaskNotificationOnlyWhenUnfocused=()=>true,playTaskNotificationSound=()=>{},bindRemoteWorkspaceIdentity=()=>{},bindRemoteWorkspacePath=()=>{},registerRemoteWorkspaceSession=()=>{},unregisterRemoteWorkspaceSession=()=>{};`;
          if (id === "\0client")
            return `export async function createWebSocketServiceConnection(url,options){const state=window.__web;state.calls++;state.closers.push(options.onClose);if(state.hold)await new Promise(resolve=>state.release=resolve);if(state.fail)throw Error('Synthetic connection failure');return {services:{},dispose:()=>{state.disposed++}}}`;
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { entries: [html] },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__web = { calls: 0, closers: [], mounts: 0, disposed: 0, status: 200 };
    window.fetch = async () =>
      new Response(JSON.stringify({ kind: "desktop-window" }), {
        status: window.__web.status,
        headers: { "content-type": "application/json" },
      });
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const draft = page.getByLabel("draft");
  await draft.fill("保留的草稿");
  await page.evaluate(() => window.dispatchEvent(new Event("zcode:resume")));
  assert.equal(await draft.inputValue(), "保留的草稿");
  assert.equal(await page.evaluate(() => window.__web.calls), 1);
  // Background closes pause retry; resume reattaches and the next close is still recoverable.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    window.__web.closers[0]({ code: 1006 });
  });
  await page.getByText("与电脑的连接已断开").waitFor();
  await page.clock.install();
  await page.clock.runFor(9000);
  assert.equal(await page.evaluate(() => window.__web.calls), 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    window.dispatchEvent(new Event("zcode:resume"));
  });
  await draft.waitFor();
  assert.equal(await page.evaluate(() => window.__web.mounts), 2);
  assert.equal(await page.evaluate(() => window.__web.props.restoreSession), false);
  assert.equal(await page.evaluate(() => window.__web.props.allowOpenWorkspace), false);
  await page.evaluate(() => {
    window.__web.fail = true;
    window.__web.closers[1]({ code: 1006 });
  });
  await page.getByText("与电脑的连接已断开").waitFor();
  // Three backoff attempts, then stop. No browser reload and no standalone fallback.
  for (const [delay, count] of [
    [1000, 3],
    [2000, 4],
    [4000, 5],
  ]) {
    await page.clock.runFor(delay + 10);
    await page.waitForFunction((count) => window.__web.calls === count, count);
    await page.getByText("暂时无法连接，请确认电脑正在运行且处于同一网络。").waitFor();
  }
  await page.clock.runFor(15000);
  assert.equal(await page.evaluate(() => window.__web.calls), 5);
  // Rapid resume/online events share one attempt.
  await page.evaluate(() => {
    window.__web.hold = true;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("zcode:resume"));
  });
  await page.waitForFunction(() => window.__web.calls === 6);
  await page.evaluate(() => {
    window.__web.fail = false;
    window.__web.release();
  });
  await draft.waitFor();
  assert.equal(await page.evaluate(() => window.__web.mounts), 3);
  // Revoked authorization terminates automatic recovery.
  await page.evaluate(() => {
    window.__web.status = 401;
    window.__web.closers[5]({ code: 1006 });
  });
  await page.getByText("与电脑的连接已断开").waitFor();
  await page.clock.runFor(1010);
  await page.getByText("连接授权已失效，请在连接设置中重新连接电脑。").waitFor();
  await page.clock.runFor(15000);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  assert.equal(await page.evaluate(() => window.__web.calls), 6);
  assert.equal(await draft.count(), 0);
  // A socket that closes while opening must not mount a stale Root when its promise resolves.
  await page.evaluate(() => {
    window.__web.status = 200;
    window.__web.hold = true;
  });
  await page.getByRole("button", { name: "重试连接" }).click();
  await page.waitForFunction(() => window.__web.calls === 7);
  await page.evaluate(() => {
    window.__web.closers[6]({ code: 1006 });
    window.__web.release();
  });
  await page.getByText("暂时无法连接，请确认电脑正在运行且处于同一网络。").waitFor();
  assert.equal(await page.evaluate(() => window.__web.mounts), 3);
  assert.equal(await draft.count(), 0);
  await page.evaluate(() => {
    window.__web.hold = false;
  });
  await page.clock.runFor(2010);
  await draft.waitFor();
  assert.equal(await page.evaluate(() => window.__web.mounts), 4);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: Web bootstrap close/resume, serial bounded retries, repeated disconnect, unchanged healthy draft, authorization denied without standalone fallback.\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
}
