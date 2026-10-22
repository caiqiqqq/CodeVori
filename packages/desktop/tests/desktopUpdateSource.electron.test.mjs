// 隔离 Electron、真实 electron-updater/Manifest provider/IPC；只替换日志和远端响应。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const desktop = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = createRequire(requireDesktop.resolve("tsup/package.json"))("esbuild");
const root = await mkdtemp(join(tmpdir(), "codevori-update-source-"));
try {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "codevori-update-fixture", version: "0.0.1", main: "main.cjs" }),
  );
  await build({
    stdin: {
      resolveDir: desktop,
      sourcefile: "desktop-update-source-fixture.ts",
      contents: `
        import assert from 'node:assert/strict';
        import {writeSync} from 'node:fs';
        import {join} from 'node:path';
        import {app,BrowserWindow,ipcMain,session} from 'electron';
        import {autoUpdater} from 'electron-updater';
        import {PlatformChannels} from '@zcode/shared';
        import {CODEVORI_DESKTOP_MANIFEST_URL,resolveDesktopUpdatePolicy} from './src/main/desktopUpdatePolicy.ts';
        import {initAutoUpdater,getAutoUpdaterState,onAutoUpdaterStateChanged,checkForUpdateMenuClick,
          refreshAutoUpdaterReleaseChannel,resolveUpdateFeedSourceFromStartupConfig} from './src/main/autoUpdater.ts';
        app.setPath('userData',join(${JSON.stringify(root)},'profile'));
        let packaged=true;
        Object.defineProperty(app,'isPackaged',{get:()=>packaged});
        const settings={receivePreviewUpdates:false,autoDownloadAndInstallUpdates:false};
        const requests=[];
        let unavailable=false;
        const checksum=Buffer.alloc(64,1).toString('base64');
        const files=['mac-arm64.zip','mac-arm64.dmg','win-x64.exe','linux-x86_64.AppImage',
          'linux-amd64.deb','linux-x86_64.rpm','linux-x64.pkg.tar.zst'].map(suffix=>({
            url:'/releases/v0.0.4/hash/CodeVori-0.0.4-'+suffix,size:32,sha512:checksum}));
        function settled(predicate){
          if(predicate(getAutoUpdaterState()))return Promise.resolve(getAutoUpdaterState());
          return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{dispose();reject(new Error('Update state timeout: '+JSON.stringify(getAutoUpdaterState())))},10000);
            const dispose=onAutoUpdaterStateChanged(state=>{
              if(predicate(state)){clearTimeout(timer);dispose();setImmediate(()=>resolve(state));}
            });
          });
        }
        async function main(){
          await app.whenReady();
          const netSession=session.fromPartition('electron-updater',{cache:false});
          await netSession.protocol.handle('https',request=>{
            const url=new URL(request.url);requests.push(url);
            assert.equal(url.origin,'https://aimodetest.cn','No upstream fallback or packaged override');
            assert.equal(url.pathname,'/api/v1/releases/electron/manifest');
            assert.match(url.searchParams.get('platform'),/^(darwin|windows|linux)-/);
            assert.equal(url.searchParams.get('device_mid'),'fixture-device');
            if(unavailable)return new Response('missing',{status:404});
            const preview=url.searchParams.get('channel')==='3';
            return new Response(JSON.stringify({version:preview?'0.0.5-beta.1':'0.0.4',
              releaseNotes:'fixture release',files}),{headers:{'Content-Type':'application/json'}});
          });
          const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
          await win.loadURL('about:blank');
          ipcMain.on('fixture-check-update',()=>checkForUpdateMenuClick(win));
          const manual=()=>win.webContents.executeJavaScript(
            'new Promise(resolve=>{const {ipcRenderer}=require("electron");ipcRenderer.once('+JSON.stringify(PlatformChannels.UpdateCheckResult)+',(_event,result)=>resolve(result));ipcRenderer.send("fixture-check-update");})');
          const production=resolveDesktopUpdatePolicy('production');
          assert.equal(production.checkOfficialMinimumVersion,false);
          const source=resolveUpdateFeedSourceFromStartupConfig({
            argv:['app','--zcode-update-feed-url=https://override.invalid/manifest'],
            env:{ZCODE_UPDATE_FEED_URL:'https://env.invalid/manifest'}});
          assert.equal(source,undefined,'Packaged apps ignore startup overrides');
          await initAutoUpdater({enabled:production.enabled,deviceMid:'fixture-device',
            updateFeedSource:source,resolveEndpointOrigin:()=> 'https://business.invalid',
            settingService:{get:async()=>settings,update:async change=>Object.assign(settings,change)}});
          const available=await settled(state=>state.kind==='update-available');
          assert.equal(available.version,'0.0.4');assert.equal(available.channel,'stable');
          assert.equal(requests.length,1);assert.equal(requests[0].searchParams.get('channel'),'1');
          assert.equal(autoUpdater.autoDownload,false,'Existing user download preference is retained');
          assert.equal((await manual()).kind,'available','Manual check uses the existing native IPC result');
          const provider=await autoUpdater.clientPromise;
          const resolved=provider.resolveFiles({version:'0.0.4',files});
          assert.ok(resolved.length>0);
          for(const file of resolved){
            assert.ok(files.some(info=>file.url.href===new URL(info.url,CODEVORI_DESKTOP_MANIFEST_URL).href));
            assert.equal(file.info.sha512,checksum);
          }
          settings.receivePreviewUpdates=true;refreshAutoUpdaterReleaseChannel(true);
          const preview=await settled(state=>state.kind==='update-available'&&state.channel==='preview');
          assert.equal(preview.version,'0.0.5-beta.1');
          assert.equal(requests.at(-1).searchParams.get('channel'),'3');
          unavailable=true;settings.receivePreviewUpdates=false;refreshAutoUpdaterReleaseChannel(false);
          await settled(state=>state.kind==='idle'&&state.enabled);
          assert.equal((await manual()).kind,'error','Missing manifest reports failure without upstream fallback');
          const count=requests.length;
          const previewPolicy=resolveDesktopUpdatePolicy('preview');
          assert.equal(previewPolicy.checkOfficialMinimumVersion,false);
          await initAutoUpdater({enabled:previewPolicy.enabled});
          assert.deepEqual(getAutoUpdaterState(),{kind:'idle',enabled:false});
          assert.equal((await manual()).kind,'dev-skipped');
          refreshAutoUpdaterReleaseChannel(true);assert.equal(requests.length,count);
          packaged=false;
          assert.deepEqual(resolveUpdateFeedSourceFromStartupConfig({argv:['app','--zcode-update-feed-url','https://dev.invalid/feed'],
            env:{ZCODE_UPDATE_FEED_URL:'https://env.invalid/feed'}}),{url:'https://dev.invalid/feed'});
          assert.deepEqual(resolveUpdateFeedSourceFromStartupConfig({argv:[],env:{ZCODE_UPDATE_FEED_URL:'https://env.invalid/feed'}}),
            {url:'https://env.invalid/feed'});
          assert.equal((await manual()).kind,'dev-skipped');assert.equal(requests.length,count);
          win.destroy();writeSync(1,'DESKTOP_UPDATE_SOURCE_PASS\\n');
        }
        main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1)});
      `,
    },
    outfile: join(root, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    nodePaths: requireDesktop.resolve.paths("electron-updater") ?? [],
    external: ["electron"],
    logLevel: "silent",
    plugins: [
      {
        name: "isolate-update-boundaries",
        setup(build) {
          build.onResolve({ filter: /^@zcode\/shared$/ }, () => ({
            path: "shared",
            namespace: "fixture",
          }));
          build.onResolve({ filter: /\.\/logger\.js$/ }, () => ({
            path: "logger",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents:
              path === "logger"
                ? "export const logger={debug(){},info(){},warn(){},error(){}};"
                : ["protocol", "channels", "desktopMenu", "version", "zcodeEndpoint"]
                    .map(
                      (file) =>
                        `export * from ${JSON.stringify(resolve(desktop, `../shared/src/${file}.ts`))};`,
                    )
                    .join("\n"),
            resolveDir: desktop,
          }));
        },
      },
    ],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.ZCODE_AUTO_UPDATE_DEV;
  const result = await promisify(execFile)(requireDesktop("electron"), [root], {
    env,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /DESKTOP_UPDATE_SOURCE_PASS/, result.stderr);
  console.log(
    "PASS real Electron updater: own source, packaged overrides, channels, relative packages, manual IPC, no upstream fallback, Preview and dev boundaries",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
