// Real Electron transport, synthetic loopback GitLab only; no saved accounts or remote writes.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "zcode-forge-native-"));
const entry = join(directory, "fixture-entry.mjs");
const bundle = join(directory, "fixture.mjs");
try {
  await mkdir(join(directory, "profile"), { recursive: true });
  await writeFile(
    entry,
    `
    import assert from 'node:assert/strict';
    import {createServer} from 'node:http';
    import {app, BrowserWindow, session} from 'electron';
    import {executeForgeWebMedia} from ${JSON.stringify(fileURLToPath(new URL("../src/main/electronForgeWebMedia.ts", import.meta.url)))};
    app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
    app.on('window-all-closed',()=>{});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64');
    const calls=[];
    let redirect=false;
    let signIn=true;
    const server=createServer((request,response)=>{
      calls.push({url:request.url,cookie:request.headers.cookie,token:request.headers['private-token']});
      if(request.url==='/git/users/sign_in') {
        response.writeHead(200,{'Content-Type':'text/html',...(signIn?{'Set-Cookie':'_gitlab_session=synthetic-session; Path=/; HttpOnly; SameSite=Lax'}:{})});
        response.end('<html><body>Synthetic signed-in session</body></html>');return;
      }
      if(request.headers.cookie!=='_gitlab_session=synthetic-session') {response.writeHead(401);response.end();return;}
      if(request.url==='/git/api/v4/user'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({username:'synthetic-user'}));return;}
      if(redirect){response.writeHead(302,{Location:'/must-not-follow'});response.end();return;}
      response.writeHead(200,{'Content-Type':'image/png'});response.end(png);
    });
    server.listen(0,'0.0.0.0',async()=>{
      try {
        await app.whenReady();
        const port=server.address().port;
        const api='http://127.0.0.1:'+port+'/git';
        const web='http://localhost:'+port+'/git';
        const context={accountId:'3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01',username:'synthetic-user',serverUrl:api,repository:'team/project',repositoryUrl:api+'/team/project',url:api+'/team/project/uploads/0123456789abcdef0123456789abcdef/image.png',loginUrl:web+'/users/sign_in'};
        const parent=new BrowserWindow({show:false});
        const keeper=new BrowserWindow({show:false});
        const windows=[];
        app.on('browser-window-created',(_event,window)=>{if(window.id!==parent.id&&window.id!==keeper.id){window.hide();windows.push(window);}});
        const signal=new AbortController().signal;
        const transport=(action)=>executeForgeWebMedia({win:parent,action,context,signal});
        await assert.rejects(transport('read'),/FORGE_MEDIA_AUTHENTICATION/);
        assert.equal(windows.length,0);
        await transport('authenticate');
        assert.equal(windows.length,1);
        const profile=windows[0].webContents.session;
        if(!windows[0].isDestroyed()) await new Promise(resolve=>windows[0].once('closed',resolve));
        assert.equal(windows[0].isDestroyed(),true);
        // The login origin differs from the bound API: only the explicitly selected cookie may cross internally.
        assert.equal((await profile.cookies.get({url:context.url})).length,0);
        const preview=await transport('read');
        assert.equal(preview.dataBase64,png.toString('base64'));
        assert.equal(preview.totalBytes,png.length);
        await transport('authenticate');
        assert.equal(windows.length,1);
        redirect=true;
        await assert.rejects(transport('read'),/FORGE_MEDIA_AUTHENTICATION/);
        assert.equal(calls.some(c=>c.url==='/must-not-follow'),false);
        assert.equal(calls.some(c=>c.token),false);
        assert.doesNotMatch(JSON.stringify(preview),/synthetic-session/);
        signIn=false;
        for(const mode of ['close','abort','parent']) {
          console.log('Checking native cancellation: '+mode);
          await profile.cookies.remove(context.loginUrl,'_gitlab_session');
          const opened=new Promise(resolve=>app.once('browser-window-created',(_event,window)=>resolve(window)));
          const controller=new AbortController();
          const cancelled=assert.rejects(executeForgeWebMedia({win:parent,action:'authenticate',context,signal:controller.signal}),/FORGE_MEDIA_AUTHENTICATION_CANCELLED/);
          const window=await opened;
          if(mode==='close')window.close();
          if(mode==='abort')controller.abort();
          if(mode==='parent')parent.close();
          await cancelled;
          console.log('Native cancellation settled: '+mode);
          if(!window.isDestroyed())await new Promise(resolve=>window.once('closed',resolve));
          assert.equal(window.isDestroyed(),true);
        }
        console.log('Electron native image/login/alias-cookie/redirect/cancel/owner-disposal test passed.');
        await new Promise(resolve=>server.close(resolve));
        app.exit(0);
      } catch(error) { console.error(error); server.close(); app.exit(1); }
    });
  `,
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __pathDirname } from "node:path"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);',
    },
    external: ["electron"],
    plugins: [
      {
        name: "native-runtime-dependencies",
        setup(builder) {
          builder.onResolve(
            { filter: /^(node-pty|ssh2|undici|@larksuiteoapi\/node-sdk|yaml|node-forge|yauzl)$/ },
            (args) => ({ path: require.resolve(args.path), external: true }),
          );
        },
      },
    ],
    logLevel: "error",
  });
  const env = { ...process.env, NODE_PATH: join(root, "node_modules") };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [bundle, "--disable-gpu"], {
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  if (code !== 0) throw new Error(`Electron native media test exited with ${code}`);
  if (!output.includes("owner-disposal test passed."))
    throw new Error("Electron exited before completing native media assertions");
} finally {
  await rm(directory, { recursive: true, force: true });
}
