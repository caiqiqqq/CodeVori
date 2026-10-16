// Real App/React Native Web controls; native camera, SafeArea, SecureStore and WebView adapters are synthetic.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import jsQR from "jsqr";
import { PRODUCT_NAME } from "@zcode/shared/product-brand";

const root = resolve(import.meta.dirname, "..");
const name = `__pairing-${process.pid}`;
const html = join(root, `${name}.html`),
  entry = join(root, `${name}.jsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-pairing-"));
const link = "http://codevori.example.test:52235/?token=synthetic%2B%2F%3Dtoken";
let server, browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><div id="root"></div><script type="module" src="./${name}.jsx"></script>`,
  );
  await writeFile(
    entry,
    `
    import React from 'react';import {createRoot} from 'react-dom/client';import App from './App.tsx';
    window.__mobile={permission:{granted:false,canAskAgain:true},nextPermission:{granted:true,canAskAgain:true},permissionRequests:0,saveCalls:[]};
    createRoot(document.getElementById('root')).render(<App/>);
  `,
  );
  server = await createServer({
    configFile: false,
    root,
    logLevel: "warn",
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      alias: [
        { find: /^react-native$/, replacement: "\0native" },
        { find: /^expo-camera$/, replacement: join(root, "test/fixtures/camera.jsx") },
        { find: /^expo-secure-store$/, replacement: join(root, "test/fixtures/secureStore.js") },
        { find: /^react-native-safe-area-context$/, replacement: "\0safe-area" },
        { find: /^expo-status-bar$/, replacement: "\0status-bar" },
        { find: /^react-native-webview$/, replacement: "\0webview" },
      ],
    },
    plugins: [
      {
        name: "native-test-adapters",
        resolveId(id) {
          if (id.startsWith("\0")) return id;
        },
        load(id) {
          if (id === "\0native")
            return `export * from 'react-native-web';
            const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);window.__mobile.appState=next=>{AppState.currentState=next;listeners.forEach(listener=>listener(next))};return {remove:()=>listeners.delete(fn)}}};`;
          if (id === "\0safe-area") return "export {View as SafeAreaView} from 'react-native-web'";
          if (id === "\0status-bar") return "export const StatusBar=()=>null";
          if (id === "\0webview")
            return `import React,{useEffect,useImperativeHandle,forwardRef} from 'react';export const WebView=forwardRef(({source,style,onError,onContentProcessDidTerminate},ref)=>{useImperativeHandle(ref,()=>({injectJavaScript:script=>window.__mobile.injections=(window.__mobile.injections??[]).concat(script)}),[]);window.__mobile.contentTerminated=onContentProcessDidTerminate;useEffect(()=>{window.__mobile.remoteMounts=(window.__mobile.remoteMounts??0)+1},[]);useEffect(()=>{window.__mobile.remoteLoads=(window.__mobile.remoteLoads??0)+1},[source]);window.__mobile.remoteError=onError;return React.createElement('div',{'data-testid':'remote','data-url':source.uri,style:{flex:1,backgroundColor:style.backgroundColor}},'Synthetic WebView')})`;
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { entries: [html] },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on("pageerror", (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${name}.html`;
  const address = page.getByLabel("连接地址或完整链接"),
    token = page.getByLabel("访问 Token");
  const scan = page.getByRole("button", { name: "扫描二维码", exact: true });
  const connect = page.getByRole("button", { name: "连接桌面端", exact: true });
  const reset = async () => {
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await scan.waitFor();
  };
  await page.goto(url);
  await scan.waitFor();
  await page.getByText(`连接 ${PRODUCT_NAME}`, { exact: true }).waitFor();
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 568 });
      await address.fill("http://codevori.example.test:52235");
      await token.fill("manual-test-token");
      await connect.scrollIntoViewIfNeeded();
      assert.equal(await connect.isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        animations: "disabled",
        path: join(artifacts, `form-${theme}-${width}.png`),
      });
    }
  }
  await connect.tap();
  await page.getByTestId("remote").waitFor();
  assert.equal(
    await page.getByTestId("remote").getAttribute("data-url"),
    "http://codevori.example.test:52235/?token=manual-test-token",
  );
  await page.reload();
  await page.getByTestId("remote").waitFor();

  // Connected shell has no permanent address row. Opening/canceling settings retains the live page.
  const settings = page.getByRole("button", { name: "连接设置", exact: true });
  const cancel = page.getByRole("button", { name: "继续使用", exact: true });
  const change = page.getByRole("button", { name: "更换连接", exact: true });
  const remote = page.getByTestId("remote");
  let remoteNode = await remote.elementHandle();
  const saved = await page.evaluate(() => ({ ...sessionStorage }));
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 568 });
      assert.equal(await page.getByText("codevori.example.test:52235", { exact: true }).count(), 0);
      const bounds = await remote.boundingBox();
      assert.equal(bounds.y, 0);
      assert.equal(bounds.height, 568);
      const button = await settings.boundingBox();
      assert.ok(button.width >= 44 && button.height >= 44);
      assert.ok(button.y > 100 && button.y + button.height < 468);
      await page.screenshot({
        animations: "disabled",
        path: join(artifacts, `connected-${theme}-${width}.png`),
      });
      await settings.tap();
      await cancel.waitFor();
      await page.getByRole("dialog").waitFor();
      const card = await page.getByTestId("connection-settings").boundingBox();
      const changeBounds = await change.boundingBox();
      assert.ok(card.height > 200 && card.y >= 0 && card.y + card.height <= 568);
      assert.ok(changeBounds.y + changeBounds.height <= card.y + card.height);
      await page.getByText("codevori.example.test:52235", { exact: true }).waitFor();
      assert.equal(await page.getByText("manual-test-token", { exact: false }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        animations: "disabled",
        path: join(artifacts, `settings-${theme}-${width}.png`),
      });
      await cancel.tap();
      await cancel.waitFor({ state: "hidden" });
      assert.equal(await remoteNode.evaluate((node) => node.isConnected), true);
      assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), saved);
      assert.equal(await page.evaluate(() => window.__mobile.remoteMounts), 1);
      assert.equal(await page.evaluate(() => window.__mobile.remoteLoads), 1);
    }
  }

  // Native PanResponder uses real touch gestures; a drag must not trigger settings.
  const cdp = await page.context().newCDPSession(page);
  const drag = async (x, y) => {
    const box = await settings.boundingBox();
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let step = 1; step <= 5; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: from.x + ((x - from.x) * step) / 5, y: from.y + ((y - from.y) * step) / 5 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await drag(60, 90);
  await page.waitForFunction(
    () => document.querySelector('[aria-label="连接设置"]').getBoundingClientRect().x < 100,
  );
  assert.equal(await cancel.count(), 0);
  await settings.tap();
  await cancel.tap();
  await cancel.waitFor({ state: "hidden" });
  for (const [x, y] of [
    [1, 1],
    [389, 567],
  ]) {
    await drag(x, y);
    const box = await settings.boundingBox();
    assert.ok(box.x >= 8 && box.y >= 8 && box.x + box.width <= 382 && box.y + box.height <= 560);
    assert.equal(await cancel.count(), 0);
  }
  await page.setViewportSize({ width: 320, height: 480 });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="连接设置"]').getBoundingClientRect().right <= 312,
  );
  await settings.tap();
  await cancel.tap();
  await cancel.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__mobile.remoteMounts), 1);
  await page.evaluate(() => {
    window.__mobile.appState("background");
    window.__mobile.appState("active");
  });
  assert.equal(await page.evaluate(() => window.__mobile.injections.length), 1);
  assert.equal(await page.evaluate(() => window.__mobile.remoteMounts), 1);
  await page.evaluate(() => window.__mobile.contentTerminated());
  await page.waitForFunction(() => window.__mobile.remoteMounts === 2);
  remoteNode = await remote.elementHandle();
  assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), saved);
  await page.setViewportSize({ width: 390, height: 568 });

  // Failure stays reviewable, retry admits a single delete, and only success removes the WebView.
  await settings.tap();
  await page.evaluate(() => {
    window.__mobile.failDelete = true;
  });
  await change.tap();
  await page.getByRole("alert").waitFor();
  assert.equal(await remoteNode.evaluate((node) => node.isConnected), true);
  assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), saved);
  await cancel.tap();
  await cancel.waitFor({ state: "hidden" });
  await settings.tap();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.evaluate(() => {
    window.__mobile.failDelete = false;
    window.__mobile.holdDelete = true;
  });
  await change.tap();
  const pending = page.getByRole("button", { name: "正在更换…", exact: true });
  await pending.waitFor();
  await pending.dispatchEvent("click");
  await cancel.dispatchEvent("click");
  assert.equal(await page.evaluate(() => window.__mobile.deleteCalls), 2);
  assert.equal(await pending.isVisible(), true);
  assert.equal(await remoteNode.evaluate((node) => node.isConnected), true);
  await page.evaluate(() => window.__mobile.releaseDelete());
  await scan.waitFor();
  assert.equal(await remote.count(), 0);
  assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), {});
  await address.fill(link);
  await connect.tap();
  await remote.waitFor();
  await page.evaluate(() => window.__mobile.remoteError());
  await page.getByText("无法连接桌面端", { exact: true }).waitFor();
  await change.tap();
  await page.evaluate(() => {
    window.__mobile.failDelete = true;
    window.__mobile.holdDelete = false;
  });
  await change.last().tap();
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => {
    window.__mobile.failDelete = false;
  });
  await change.last().tap();
  await scan.waitFor();
  await reset();

  // Permission denial and cancel preserve the manual draft and never persist it.
  await address.fill("http://codevori.example.test:52235");
  await scan.tap();
  await page.evaluate(() => {
    window.__mobile.nextPermission = { granted: false, canAskAgain: false };
  });
  await page.getByRole("button", { name: "允许使用相机" }).tap();
  await page.getByRole("button", { name: "前往系统设置" }).waitFor();
  await page.getByRole("button", { name: "返回手动输入" }).tap();
  assert.equal(await address.inputValue(), "http://codevori.example.test:52235");
  assert.equal(await page.evaluate(() => window.__mobile.saveCalls.length), 0);

  await page.evaluate(() => {
    window.__mobile.permission = { granted: true, canAskAgain: true };
  });
  await scan.tap();
  await page.getByTestId("camera").waitFor();
  assert.deepEqual(await page.evaluate(() => window.__mobile.scanTypes), ["qr"]);
  await page.evaluate(() => {
    window.__mobile.backgroundScan = window.__mobile.scan;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__mobile.appState(document.visibilityState === "hidden" ? "background" : "active");
  });
  await page.getByTestId("camera").waitFor({ state: "detached" });
  await page.evaluate((link) => window.__mobile.backgroundScan(link), link);
  assert.equal(await page.getByRole("button", { name: "连接桌面端", exact: true }).count(), 0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__mobile.appState(document.visibilityState === "hidden" ? "background" : "active");
  });
  await page.getByTestId("camera").waitFor();
  await page.evaluate(() => window.__mobile.scan("https://zcode.z.ai/remote/v4?token=wrong"));
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "重新扫描" }).tap();

  // Decode a locally generated desktop-format QR before delivering its camera event.
  const { default: QRCode } = await import("qrcode");
  const image = await QRCode.toDataURL(link, { width: 240, margin: 4 });
  const pixels = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return {
      pixels: [...ctx.getImageData(0, 0, image.width, image.height).data],
      width: image.width,
      height: image.height,
    };
  }, image);
  const decoded = jsQR(new Uint8ClampedArray(pixels.pixels), pixels.width, pixels.height);
  assert.equal(decoded?.data, link);
  await page.evaluate((link) => {
    const stale = window.__mobile.scan;
    stale(link);
    stale("http://10.0.0.2:3030/?token=wrong");
    window.__mobile.staleScan = stale;
  }, decoded.data);
  await address.waitFor();
  assert.equal(await address.inputValue(), "http://codevori.example.test:52235/");
  assert.equal(await token.inputValue(), "synthetic+/=token");
  assert.equal(await page.getByTestId("camera").count(), 0);
  assert.equal(
    await page.evaluate(() => window.__mobile.saveCalls.length),
    0,
    "Scanning needs user confirmation",
  );
  await page.evaluate(() => window.__mobile.staleScan("http://10.0.0.2:3030/?token=late"));
  assert.equal(await address.inputValue(), "http://codevori.example.test:52235/");
  await page.screenshot({
    animations: "disabled",
    path: join(artifacts, "scanned-confirmation.png"),
  });

  // Persistence failure retains input; pending saves admit only one submission.
  await page.evaluate(() => {
    window.__mobile.failSave = true;
  });
  await connect.tap();
  await page.getByRole("alert").waitFor();
  assert.equal(await token.inputValue(), "synthetic+/=token");
  await page.evaluate(() => {
    window.__mobile.failSave = false;
    window.__mobile.holdSave = true;
  });
  await connect.tap();
  await page.getByRole("button", { name: "正在保存连接…" }).waitFor();
  await page.getByRole("button", { name: "正在保存连接…" }).dispatchEvent("click");
  assert.equal(await page.evaluate(() => window.__mobile.saveCalls.length), 2);
  await page.evaluate(() => window.__mobile.releaseSave());
  await page.getByTestId("remote").waitFor();
  assert.equal(await page.getByTestId("remote").getAttribute("data-url"), link);
  await reset();
  await page.evaluate(() => {
    window.__mobile.permission = { granted: true, canAskAgain: true };
  });
  await scan.tap();
  await page.getByTestId("camera").waitFor();
  await page.evaluate(() =>
    window.__mobile.cameraError({ message: "Synthetic camera unavailable" }),
  );
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "返回手动输入" }).tap();
  assert.equal(await page.evaluate(() => window.__mobile.saveCalls.length), 0);
  await address.fill(link);
  await connect.tap();
  await page.getByTestId("remote").waitFor();
  assert.equal(
    await page.evaluate(() => window.__mobile.saveCalls[0].options.keychainAccessible),
    "test-device-only",
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: connected shell/settings/cancel/change/failure/retry, manual/paste/QR confirmation, denied permission/cancel, invalid and repeated scans, persistence retry/restore, 320/390px light/dark. Native adapters mocked. Artifacts: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(entry, { force: true })]);
}
