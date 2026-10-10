// Actual Electron windows/session, synthetic HTTPS protocol responses only.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "zcode-github-image-native-"));
const entry = join(directory, "entry.mjs");
const bundle = join(directory, "bundle.mjs");
try {
  await writeFile(
    entry,
    `
    import assert from 'node:assert/strict';
    import {createHash} from 'node:crypto';
    import {app,BrowserWindow,session} from 'electron';
    import {executeGithubImageUpload} from ${JSON.stringify(new URL("../src/main/electronGithubImageUpload.ts", import.meta.url).pathname)};
    app.setPath('userData',${JSON.stringify(directory)});
    app.on('window-all-closed',()=>{});
    const deadline=setTimeout(()=>{console.error('Native test timed out');app.exit(1)},20000);
    app.whenReady().then(async () => {
    const context={accountId:'3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01',username:'tester',serverUrl:'https://github.com',repository:'synthetic/project',repositoryUrl:'https://github.com/synthetic/project',image:{filename:'screen.png',mediaType:'image/png',dataBase64:'iVBORw0KGgo=',totalBytes:8}};
    const url='https://github.com/user-attachments/assets/4c88bcca-98b9-4aaa-9c0c-2f869f0c1b01';
    const key=createHash('sha256').update(JSON.stringify([context.serverUrl,context.accountId,context.username])).digest('hex');
    const profile=session.fromPartition('persist:github-issue-upload-'+key);
    let username='tester',hasInput=true;
    await profile.protocol.handle('https',()=>new Response('<!doctype html><meta name="user-login" content="'+username+'"><textarea aria-label="Markdown value"></textarea>'+(hasInput?'<input type="file"><script>document.querySelector("input").addEventListener("change",()=>{document.querySelector("textarea").value="![image]('+url+')"})</script>':''),{headers:{'Content-Type':'text/html'}}));
    app.on('browser-window-created',(_event,window)=>window.hide());
    const parent=new BrowserWindow({show:false});const keeper=new BrowserWindow({show:false});
    const run=(signal=new AbortController().signal)=>executeGithubImageUpload({win:parent,context,signal});
    try {
      assert.deepEqual(await run(),{url});
      assert.equal(BrowserWindow.getAllWindows().length,2,'Successful upload closes only its native window');
      await profile.cookies.set({url:'https://github.com',name:'synthetic-session',value:'wrong-account'});
      username='different-user';
      await assert.rejects(run(),/FORGE_MEDIA_IDENTITY_CHANGED/);
      assert.equal((await profile.cookies.get({name:'synthetic-session'})).length,0,'Wrong isolated session is cleared for an explicit retry');
      username='tester';hasInput=false;
      const controller=new AbortController();const cancelled=assert.rejects(run(controller.signal),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      setTimeout(()=>controller.abort(),100);await cancelled;
      assert.equal(BrowserWindow.getAllWindows().length,2);
      await assert.rejects(executeGithubImageUpload({win:parent,signal:new AbortController().signal,context:{...context,repositoryUrl:'https://other.example.invalid/project'}}),/FORGE_INVALID_MEDIA/);
      const parentClosed=assert.rejects(run(),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      setTimeout(()=>parent.destroy(),100);await parentClosed;
      assert.equal(BrowserWindow.getAllWindows().length,1,'Parent disposal closes the upload window');
      console.log('Native GitHub image upload Electron tests passed');clearTimeout(deadline);if(!parent.isDestroyed())parent.destroy();keeper.destroy();app.exit(0);
    }catch(error){console.error(error);clearTimeout(deadline);app.exit(1)}
    }).catch(error=>{console.error(error);app.exit(1)});
  `,
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    target: "node24",
  });
  const electron = process.env.ZCODE_ELECTRON_TEST_BINARY ?? require("electron");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [bundle], {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (result !== 0) throw new Error(`Native Electron test exited ${result}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
