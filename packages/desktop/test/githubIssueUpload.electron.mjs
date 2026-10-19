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
    import {applyDesktopChromiumNetworkPolicies} from ${JSON.stringify(new URL("../src/main/desktopNetworkPolicy.ts", import.meta.url).pathname)};
    app.setPath('userData',${JSON.stringify(directory)});
    app.on('window-all-closed',()=>{});
    const deadline=setTimeout(()=>{console.error('Native test timed out');app.exit(1)},20000);
    app.whenReady().then(async () => {
    const context={accountId:'3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01',username:'tester',serverUrl:'https://github.com',repository:'synthetic/project',repositoryUrl:'https://github.com/synthetic/project',image:{filename:'screen.png',mediaType:'image/png',dataBase64:'iVBORw0KGgo=',totalBytes:8}};
    const url='https://github.com/user-attachments/assets/4c88bcca-98b9-4aaa-9c0c-2f869f0c1b01';
    const key=createHash('sha256').update(JSON.stringify([context.serverUrl,context.accountId,context.username])).digest('hex');
    const profile=session.fromPartition('persist:github-issue-upload-'+key);
    await applyDesktopChromiumNetworkPolicies(session,{httpProxy:'http://127.0.0.1:17890',httpProxyOnlyDomains:'github.com'},{info(){},warn(){}});
    let policyCalls=0;const setProxy=profile.setProxy.bind(profile);profile.setProxy=(config)=>{policyCalls++;return setProxy(config)};
    let username='tester',hasInput=true,currentEditor=false,delayedReact=false,loginUsername,loginReads=0,holdLogin=false,uploadReads=0,failNavigation;
    await profile.protocol.handle('https',(request)=>{
      assert.equal(policyCalls,1,'Proxy policy must complete before navigation');
      const target=new URL(request.url);
      if(failNavigation===(target.pathname==='/login'?'login':'repository'))return Response.error();
      if(target.pathname==='/login'){
        loginReads++;assert.equal(target.searchParams.get('return_to'),context.repositoryUrl+'/issues/new');
        if(loginUsername!==undefined)username=loginUsername;
        return new Response('<!doctype html><h1>GitHub login</h1>'+(holdLogin?'':'<script>location.replace('+JSON.stringify(target.searchParams.get('return_to'))+')</script>'),{headers:{'Content-Type':'text/html'}});
      }
      uploadReads++;
      if(delayedReact&&hasInput)return new Response('<!doctype html><meta name="user-login" content="'+username+'"><react-app><fieldset><legend>Add a description</legend><textarea aria-label="Markdown value"></textarea></fieldset></react-app><script>window.__dispatches=0;document.addEventListener("paste",()=>window.__dispatches++,true);window.addEventListener("load",()=>setTimeout(()=>{if(window.__dispatches)throw Error("Image dispatched before hydration");document.querySelector("textarea").addEventListener("paste",event=>{event.preventDefault();if(++window.__pastes!==1)throw Error("Repeated paste");document.querySelector("textarea").value="![image]('+url+')"});window.__pastes=0;document.querySelector("react-app").classList.add("loaded")},100))</script>',{headers:{'Content-Type':'text/html'}});
      if(currentEditor&&hasInput)return new Response('<!doctype html><meta name="user-login" content="'+username+'"><label id="description">Add a description</label><textarea aria-labelledby="description"></textarea><script>document.querySelector("textarea").addEventListener("paste",event=>{event.preventDefault();document.querySelector("textarea").value="![image]('+url+')"})</script>',{headers:{'Content-Type':'text/html'}});
      return new Response('<!doctype html><meta name="user-login" content="'+username+'"><textarea aria-label="Markdown value" '+(hasInput?'':'disabled')+'></textarea>'+(hasInput?'<input type="file"><script>document.querySelector("input").addEventListener("change",()=>{document.querySelector("textarea").value="![image]('+url+')"})</script>':''),{headers:{'Content-Type':'text/html'}});
    });
    let createdWindows=0,loadError;app.on('browser-window-created',(_event,window)=>{createdWindows++;window.hide();if(loadError)window.loadURL=()=>Promise.reject(loadError)});
    const parent=new BrowserWindow({show:false});const keeper=new BrowserWindow({show:false});
    const navigationFailures=[];
    const run=(signal=new AbortController().signal)=>executeGithubImageUpload({win:parent,context,signal,onNavigationFailure:details=>navigationFailures.push(details)});
    try {
      assert.deepEqual(await run(),{url});
      currentEditor=true;assert.deepEqual(await run(),{url});
      delayedReact=true;assert.deepEqual(await run(),{url});delayedReact=false;
      assert.equal(await profile.resolveProxy('https://github.com'),'PROXY 127.0.0.1:17890');
      assert.equal(await profile.resolveProxy('https://other.test'),'DIRECT');
      assert.equal(BrowserWindow.getAllWindows().length,2,'Successful upload closes only its native window');
      failNavigation='repository';
      await assert.rejects(run(),/FORGE_NETWORK/);
      assert.deepEqual(navigationFailures.splice(0),[{phase:'repository',code:'ERR_FAILED',errno:-2}],'Repository navigation must retain only safe Chromium error fields');
      assert.equal(BrowserWindow.getAllWindows().length,2,'Failed navigation closes only its upload window');
      failNavigation='login';username='';
      await assert.rejects(run(),/FORGE_NETWORK/);
      assert.deepEqual(navigationFailures.splice(0),[{phase:'login',code:'ERR_FAILED',errno:-2}],'Login navigation has its own phase without the return URL');
      failNavigation=undefined;username='tester';
      loadError=Object.assign(new Error('Navigation failed: https://github.com/private/ERR_PRIVATE_NAME?token=secret'),{code:'https://github.com/private/ERR_PRIVATE_NAME',errno:'secret'});
      await assert.rejects(run(),/FORGE_NETWORK/);
      assert.deepEqual(navigationFailures.splice(0),[{phase:'repository'}],'Unknown errors must not extract private URL content or log raw fields');
      loadError=Object.assign(new Error('private URL must not be logged'),{code:'ERR_PROXY_CONNECTION_FAILED',errno:-130});
      await assert.rejects(run(),/FORGE_NETWORK/);
      assert.deepEqual(navigationFailures.splice(0),[{phase:'repository',code:'ERR_PROXY_CONNECTION_FAILED',errno:-130}]);
      loadError=undefined;
      await profile.cookies.set({url:'https://github.com',name:'synthetic-session',value:'wrong-account'});
      username='different-user';
      await assert.rejects(run(),/FORGE_MEDIA_IDENTITY_CHANGED/);
      assert.equal(loginReads,1,'Known wrong account receives one login recovery before failing');
      assert.equal((await profile.cookies.get({name:'synthetic-session'})).length,0,'Wrong isolated session is cleared only for recovery');
      const gitlabProfile=session.fromPartition('persist:gitlab-media-synthetic-other-platform');
      await gitlabProfile.cookies.set({url:'https://gitlab.example.invalid',name:'synthetic-gitlab',value:'retain'});
      username='other-user';loginUsername='tester';
      const windowsBefore=BrowserWindow.getAllWindows().length;
      const createdBefore=createdWindows,readsBefore=uploadReads;
      assert.deepEqual(await run(),{url});
      assert.equal(createdWindows,createdBefore+1,'Login recovery must not create another window');
      assert.equal(uploadReads,readsBefore+2,'One return to the same repository after login');
      assert.equal(loginReads,2);assert.equal(BrowserWindow.getAllWindows().length,windowsBefore,'Recovery reuses/closes one upload window');
      assert.equal((await gitlabProfile.cookies.get({name:'synthetic-gitlab'})).length,1,'GitHub sign-in never clears GitLab cookies');
      await profile.cookies.set({url:'https://github.com',name:'synthetic-session',value:'preserve-on-unsigned'});
      username='';loginUsername='tester';
      assert.deepEqual(await run(),{url});assert.equal(loginReads,3);
      assert.equal((await profile.cookies.get({name:'synthetic-session'})).length,1,'Signed-out identity does not clear storage');
      username='';loginUsername='';
      await assert.rejects(run(),/FORGE_MEDIA_AUTHENTICATION/);assert.equal(loginReads,4,'No authentication loop');
      username='';loginUsername=undefined;holdLogin=true;
      const loginController=new AbortController();const loginCancelled=assert.rejects(run(loginController.signal),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      while(loginReads<5)await new Promise(resolve=>setTimeout(resolve,5));
      const loginWindow=BrowserWindow.getAllWindows().find(window=>window!==parent&&window!==keeper);
      assert.equal(loginWindow.getTitle(),'GitHub · tester');
      assert.equal(await loginWindow.webContents.executeJavaScript('typeof context'), 'undefined','No upload context is injected on the login page');
      loginController.abort();await loginCancelled;holdLogin=false;
      assert.equal(BrowserWindow.getAllWindows().length,2);
      username='tester';hasInput=false;
      const controller=new AbortController();const cancelled=assert.rejects(run(controller.signal),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      setTimeout(()=>controller.abort(),100);await cancelled;
      assert.equal(BrowserWindow.getAllWindows().length,2);
      await assert.rejects(executeGithubImageUpload({win:parent,signal:new AbortController().signal,context:{...context,repositoryUrl:'https://other.example.invalid/project'}}),/FORGE_INVALID_MEDIA/);
      const parentClosed=assert.rejects(run(),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      setTimeout(()=>parent.destroy(),100);await parentClosed;
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(navigationFailures,[],'Late navigation rejections after cancellation must not report a network failure');
      assert.equal(BrowserWindow.getAllWindows().length,1,'Parent disposal closes the upload window');
      const setupParent=new BrowserWindow({show:false});setupParent.on('close',event=>event.preventDefault());
      const setupContext={...context,accountId:'5c88bcca-98b9-4aaa-9c0c-2f869f0c1b01'};
      const setupKey=createHash('sha256').update(JSON.stringify([setupContext.serverUrl,setupContext.accountId,setupContext.username])).digest('hex');
      const setupProfile=session.fromPartition('persist:github-issue-upload-'+setupKey);
      let release;setupProfile.setProxy=()=>new Promise(resolve=>{release=resolve});
      const setupClosed=assert.rejects(executeGithubImageUpload({win:setupParent,context:setupContext,signal:new AbortController().signal}),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
      setupParent.close();release();await setupClosed;assert.equal(BrowserWindow.getAllWindows().length,2,'A prevented parent close during network setup must not create an upload child');setupParent.destroy();
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
