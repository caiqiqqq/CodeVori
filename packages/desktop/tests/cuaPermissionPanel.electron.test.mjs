import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const desktop = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = createRequire(requireDesktop.resolve("tsup/package.json"))("esbuild");
const root = await mkdtemp(join(tmpdir(), "zcode-cua-panel-test-"));
const artifacts = await mkdtemp(join(tmpdir(), "zcode-cua-panel-shots-"));

try {
  const mainDir = join(root, "main");
  const rendererDir = join(root, "renderer");
  const preloadDir = join(root, "preload");
  const appPath = join(root, "Fixture.app");
  for (const path of [
    mainDir,
    rendererDir,
    preloadDir,
    join(appPath, "Contents", "MacOS"),
    join(appPath, "Contents", "Resources"),
  ])
    await mkdir(path, { recursive: true });
  await writeFile(join(appPath, "Contents", "Info.plist"), "fixture");
  await writeFile(join(appPath, "Contents", "MacOS", "Fixture"), "fixture");
  const html = await readFile(join(desktop, "src/renderer/cua-permission-panel.html"), "utf8");
  await writeFile(
    join(rendererDir, "cua-permission-panel.html"),
    html.replace("./cuaPermissionPanel.ts", "./cuaPermissionPanel.js"),
  );
  await build({
    entryPoints: [join(desktop, "src/renderer/cuaPermissionPanel.ts")],
    outfile: join(rendererDir, "cuaPermissionPanel.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
  });
  await build({
    entryPoints: [join(desktop, "src/preload/cuaPermissionPanel.ts")],
    outfile: join(preloadDir, "cuaPermissionPanel.cjs"),
    bundle: true,
    format: "cjs",
    platform: "node",
    external: ["electron"],
  });
  const entry = join(mainDir, "runner.mjs");
  await build({
    stdin: {
      resolveDir: desktop,
      sourcefile: "cua-permission-panel-fixture.ts",
      contents: `
        import assert from 'node:assert/strict';
        import {writeFile} from 'node:fs/promises';
        import {join} from 'node:path';
        import {setTimeout as pause} from 'node:timers/promises';
        import {app,BrowserWindow,shell} from 'electron';
        import {PlatformChannels} from '@zcode/shared';
        import {registerCuaPermissionIpcHandlers} from './src/main/desktopCuaPermissionIpc.ts';
        const root=process.argv[2],artifacts=process.argv[3];
        app.setPath('userData',join(root,'user-data'));
        delete process.env.ELECTRON_RENDERER_URL;
        let locale='zh-CN',failOpen=false,opens=0;
        globalThis.__watcherStops=0;
        // 系统设置打开与定位源均模拟；真实窗口/IPC/关闭事件参与测试，不改真实 TCC。
        shell.openExternal=async()=>{opens++;if(failOpen)throw new Error('fixture settings unavailable')};
        const results=[];
        function assertDockVisible(){if(process.platform==='darwin')assert.equal(app.dock.isVisible(),true,'Permission guide must preserve the application Dock icon')}
        async function until(predicate){const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw new Error('fixture wait timed out');await pause(20)}}
        function begin(origin,id){return origin.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.OpenCuaPermissionOnboarding)+','+JSON.stringify({operationId:id,initialPermission:'screen_recording',requiredPermissions:['screen_recording']})+')')}
        async function send(origin,payload){await origin.webContents.executeJavaScript('require("electron").ipcRenderer.send('+JSON.stringify(PlatformChannels.CancelCuaPermissionOnboarding)+','+JSON.stringify(payload)+')')}
        async function check(name,operation){try{await operation();results.push({name,passed:true})}catch(error){results.push({name,passed:false,error:error.message})}}
        async function main(){
          await app.whenReady();
          assertDockVisible();
          registerCuaPermissionIpcHandlers({logger:{info:()=>{},warn:()=>{}},currentApplicationLocale:()=>locale});
          const origins=[];
          for(let i=0;i<2;i++){const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await win.loadURL('data:text/html,<title>Permission test origin</title>');origins.push(win)}
          const panel=()=>BrowserWindow.getAllWindows().find(win=>!origins.includes(win));
          for(const language of ['zh-CN','en-US']){
            locale=language;
            await check('close cancels ungranted guide and permits retry without hiding Dock: '+language,async()=>{
              assertDockVisible();
              const request=begin(origins[0],'close-'+language);
              await until(()=>panel()?.isVisible());
              const win=panel();
              assertDockVisible();
              assert.equal(win.isFocusable(),false);
              const expected=language==='zh-CN'?'关闭权限引导':'Close permission guide';
              await until(()=>win.webContents.getTitle().includes(language==='zh-CN'?'权限':'Permissions'));
              assert.equal(await win.webContents.executeJavaScript('document.getElementById("closeButton").getAttribute("aria-label")'),expected);
              assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'),true);
              assert.ok(await win.webContents.executeJavaScript('document.getElementById("completion").textContent.length>0'));
              await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
              await writeFile(join(artifacts,'panel-'+language+'.png'),(await win.webContents.capturePage()).toPNG());
              await win.webContents.executeJavaScript('document.getElementById("closeButton").click()');
              const result=await request;
              assert.equal(result.success,false);
              assert.equal(result.canceled,true);
              assert.equal(result.returnedFromSettings,false);
              assert.notEqual(result.restartHelperAfterReturn,true);
              assert.equal(win.isDestroyed(),true);
              await until(()=>!panel());
              assertDockVisible();
            });
          }
          await check('wrong sender cannot close panel; closing shared guide settles every participant',async()=>{
            assertDockVisible();
            const first=begin(origins[0],'shared-first');
            await until(()=>panel()?.isVisible());
            const win=panel();
            assertDockVisible();
            let settled=0;
            const second=begin(origins[1],'shared-second');
            first.then(()=>settled++);second.then(()=>settled++);
            await send(origins[1],{surface:'permission-panel'});
            await pause(80);
            assert.equal(win.isDestroyed(),false);
            assert.equal(settled,0);
            assertDockVisible();
            await win.webContents.executeJavaScript('document.getElementById("closeButton").click()');
            for(const result of await Promise.all([first,second])){assert.equal(result.canceled,true);assert.equal(result.returnedFromSettings,false);assert.notEqual(result.restartHelperAfterReturn,true)}
            await until(()=>!panel());
            assertDockVisible();
          });
          await check('settings-open failure leaves no panel or watcher behind',async()=>{
            assertDockVisible();
            failOpen=true;
            const result=await begin(origins[0],'failed-open');
            assert.equal(result.success,false);
            assert.match(result.error,/fixture settings unavailable/);
            assert.equal(panel(),undefined);
            assertDockVisible();
            failOpen=false;
          });
          assert.ok(globalThis.__watcherStops>=4);
          for(const origin of origins)origin.destroy();
          console.log('CUA_PANEL_RESULTS='+JSON.stringify({results,opens,watcherStops:globalThis.__watcherStops,artifacts}));
          app.exit(results.some(result=>!result.passed)?1:0);
        }
        main().catch(error=>{console.error(error);app.exit(1)});
      `,
    },
    outfile: entry,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["electron", "original-fs"],
    plugins: [
      {
        name: "permission-panel-fixture-boundaries",
        setup(build) {
          build.onResolve(
            {
              filter:
                /(?:desktopCuaHelperInstaller|openCuaPermissionTarget|cuaSystemSettingsWindowWatcher)\.js$/,
            },
            ({ path }) => ({ path, namespace: "permission-panel-fixture" }),
          );
          build.onResolve({ filter: /^@zcode\/services\/cua-permission-broker$/ }, () => ({
            path: "identity",
            namespace: "permission-panel-fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "permission-panel-fixture" }, ({ path }) => ({
            contents: path.includes("openCuaPermissionTarget")
              ? "export function createCurrentCuaApplicationTarget(){const appPath=process.argv[2]+'/Fixture.app';return {ensureHelperInstalled:async()=>appPath,verifyHelperInstalled:async()=>{},resolveHelperIdentity:async()=>({appPath,executablePath:appPath+'/Contents/MacOS/Fixture',bundleId:'test.cua.fixture',displayName:'Fixture'})}}"
              : path.includes("cuaSystemSettingsWindowWatcher")
                ? "export function createSystemSettingsWindowWatcher(){return {start(){},latest(){return null},stop(){globalThis.__watcherStops++}}}"
                : path === "identity"
                  ? "export function resolveHelperPermissionSubjectIdentity(){throw new Error('Unexpected real identity query')}"
                  : "export function createDesktopCuaHelperInstaller(){throw new Error('Unexpected real installer')}",
          }));
        },
      },
    ],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  let result;
  try {
    result = await promisify(execFile)(requireDesktop("electron"), [entry, root, artifacts], {
      env,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    result = error;
  }
  const line = result.stdout?.split("\n").find((value) => value.startsWith("CUA_PANEL_RESULTS="));
  assert.ok(line, result.stderr ?? "Electron permission panel fixture did not report results");
  const report = JSON.parse(line.slice("CUA_PANEL_RESULTS=".length));
  for (const { name, passed, error } of report.results)
    console.log(`${passed ? "PASS" : "FAIL"}: ${name}${error ? `: ${error}` : ""}`);
  console.log(`Permission panel screenshots: ${report.artifacts}`);
  assert.equal(report.results.length, 4);
  assert.equal(report.results.filter((result) => !result.passed).length, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}
