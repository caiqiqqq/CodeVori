// Isolated native IPC/utilityProcess smoke: no user profile, Agent or model requests.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const desktop = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = createRequire(requireDesktop.resolve("tsup/package.json"))("esbuild");
const root = await mkdtemp(join(tmpdir(), "zcode-lan-native-"));
try {
  const appRoot = join(root, "desktop");
  await mkdir(appRoot);
  await mkdir(join(root, "web", "dist"), { recursive: true });
  await writeFile(join(root, "web", "dist", "index.html"), "synthetic native bridge");
  await writeFile(
    join(appRoot, "package.json"),
    JSON.stringify({ name: "zcode-lan-native-fixture", main: "main.cjs" }),
  );
  const bundle = (name, contents) =>
    build({
      stdin: { contents, resolveDir: desktop, sourcefile: `lan-${name}-fixture.ts` },
      outfile: join(appRoot, `${name}.cjs`),
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "silent",
      // 只打包本测试使用的公开网关，避免带入无关 SSH/native 服务的初始化副作用。
      alias: {
        "@zcode/server": resolve(desktop, "../server/src/desktopLanGateway.ts"),
        "@zcode/services/node": resolve(desktop, "../services/src/credential/credentialService.ts"),
      },
    });
  await bundle(
    "host",
    `
    import {ChannelServer,MessagePortProtocol,ProxyChannel} from '@zcode/rpc';
    import {HostMessageTypes} from '@zcode/shared';
    import {wrapElectronPort} from './src/host/electronPort.ts';
    import {createWindowWorkspaceProjection} from './src/host/windowWorkspaceProjection.ts';
    const projection=createWindowWorkspaceProjection('native-existing-host');
    const desktop=projection.attach(true);const attachments=new Map();let commands=0;
    process.parentPort.on('message',async({data,ports})=>{
      if(data.type===HostMessageTypes.AttachServicePort){
        const protocol=new MessagePortProtocol(wrapElectronPort(ports[0]));
        const server=new ChannelServer(protocol,'host',1000,true);
        const service={...projection.attach(false),async submit(){return ++commands;},async total(){return commands;}};
        server.registerChannel('window',ProxyChannel.fromService(service));
        attachments.set(data.attachmentId,{server,protocol});server.ready();
      }else if(data.type===HostMessageTypes.DetachServicePort){
        const entry=attachments.get(data.attachmentId);entry?.server.dispose();entry?.protocol.disconnect();attachments.delete(data.attachmentId);
      }else if(data.type==='publish'){
        await desktop.publishWorkspaceSession(data.input);process.parentPort.postMessage({published:true});
      }
    });
    process.parentPort.postMessage({ready:true});
  `,
  );
  await bundle(
    "main",
    `
    import assert from 'node:assert/strict';
    import {once} from 'node:events';
    import {join} from 'node:path';
    import {writeSync} from 'node:fs';
    import {readFile,writeFile} from 'node:fs/promises';
    import {createServer} from 'node:net';
    import {createCredentialService} from '@zcode/services/node';
    import {app,BrowserWindow,utilityProcess} from 'electron';
    import {WebSocket} from 'ws';
    import {Emitter,VSBuffer,SocketProtocol,ChannelClient,ProxyChannel} from '@zcode/rpc';
    import {PlatformChannels} from '@zcode/shared';
    import {registerDesktopLanAccess} from './src/main/desktopLanAccess.ts';
    process.env.ZCODE_DESKTOP_HOME_DIR=${JSON.stringify(root)};
    process.env.ZCODE_DATA_BASE_DIR=join(${JSON.stringify(root)},'data');
    app.setPath('userData',join(${JSON.stringify(root)},'profile'));
    app.on('window-all-closed',()=>{});
    async function main(){
      await app.whenReady();
      const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
      await win.loadURL('about:blank');
      const host=utilityProcess.fork(join(app.getAppPath(),'host.cjs'));
      const hostReady=once(host,'message');
      const hosts=new Map([[win.webContents.id,host]]);
      const errors=[];
      const preferenceFile=join(${JSON.stringify(root)},'lan-preference.json');
      const readPreference=async()=>{try{return JSON.parse(await readFile(preferenceFile,'utf8'))}catch(error){if(error.code==='ENOENT')return {};throw error}};
      const preference={getEnabled:async()=>(await readPreference()).enabled===true,setEnabled:async(enabled)=>{await writeFile(preferenceFile,JSON.stringify({...await readPreference(),enabled}))},getConfiguration:async()=>(await readPreference()).configuration,setConfiguration:async(configuration)=>{await writeFile(preferenceFile,JSON.stringify({...await readPreference(),configuration}))}};
      const credentials=createCredentialService();
      const createManager=(args)=>registerDesktopLanAccess({...args,credentials,preference:{...preference,...args.preference}});
      let manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});
      const startupRestore=manager.restore(win);await hostReady;await startupRestore;
      const readState=()=>win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.GetDesktopLanAccess)+')');
      if(process.argv.includes('--restart-enabled')||process.argv.includes('--restart-disabled')){
        await manager.restore(win);
        const restored=await readState();
        assert.equal(restored.enabled,process.argv.includes('--restart-enabled'));
        assert.equal((await readPreference()).enabled,process.argv.includes('--restart-enabled'));
        assert.deepEqual(restored.configuration,(await readPreference()).configuration);
        if(restored.enabled){
          const expected=JSON.parse(await readFile(join(${JSON.stringify(root)},'expected-pairing.json'),'utf8'));
          assert.equal(restored.token,expected.token,'Process restart cannot rotate the saved token');
          assert.deepEqual(restored.urls,expected.urls,'Process restart cannot change the saved address or port');
          assert.equal(restored.token,await credentials.load('desktop-lan-access-token-v1'));
          assert.equal(restored.urls[0],'http://'+restored.configuration.address+':'+restored.configuration.port);
          const other=new BrowserWindow({show:false});hosts.set(other.webContents.id,host);await manager.restore(other);
          other.destroy();
          await win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SetDesktopLanAccessEnabled)+',false)');
        }
        await manager.dispose();host.kill();win.destroy();assert.deepEqual(errors,[]);writeSync(1,'LAN_RESTART_PASS\\n');return;
      }
      await manager.restore(win);assert.equal((await readState()).enabled,false,'Missing preference stays disabled');
      const invoke=(enabled)=>win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SetDesktopLanAccessEnabled)+','+JSON.stringify(enabled)+')');
      const save=(configuration)=>win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SaveDesktopLanAccessConfiguration)+','+JSON.stringify(configuration)+')');
      await preference.setEnabled(true);await manager.restore(win);
      assert.equal((await readState()).enabled,false,'Legacy enabled preference waits for explicit configuration');
      await preference.setEnabled(false);
      await assert.rejects(invoke(true),'Missing configuration cannot choose a random port');
      const reservation=createServer();reservation.listen(0,'0.0.0.0');await once(reservation,'listening');
      const configuration={address:'codevori-test.local',port:reservation.address().port};
      await save(configuration);
      await assert.rejects(invoke(true),/EADDRINUSE/);assert.equal((await readState()).enabled,false);
      assert.deepEqual((await readState()).configuration,configuration,'Port conflict retains fixed configuration');
      await new Promise(resolve=>reservation.close(resolve));
      const state=await invoke(true);assert.equal(state.enabled,true);assert.equal(state.urls.length,1);
      assert.equal(state.urls[0],'http://codevori-test.local:'+configuration.port);
      await assert.rejects(save({...configuration,port:configuration.port+1}),/Disable LAN access/);
      const origin='http://127.0.0.1:'+configuration.port;
      assert.equal(await credentials.load('desktop-lan-access-token-v1'),state.token);
      await writeFile(join(${JSON.stringify(root)},'expected-pairing.json'),JSON.stringify({token:state.token,urls:state.urls}),{mode:0o600});
      const encrypted=await readFile(join(${JSON.stringify(root)},'data/.zcode/v2/credentials.json'),'utf8');
      assert.equal(encrypted.includes(state.token),false,'Token must not be written in plaintext');
      assert.match(encrypted,/enc:v1:/);
      const paired=await fetch(origin+'/?token='+encodeURIComponent(state.token),{redirect:'manual'});
      assert.equal(paired.status,303);const cookie=paired.headers.get('set-cookie').split(';')[0];
      assert.equal(await (await fetch(origin,{headers:{Cookie:cookie}})).text(),'synthetic native bridge');
      const clients=[];
      async function connect(){
        const ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Cookie:cookie,Origin:origin}});
        await once(ws,'open');const data=new Emitter();const close=new Emitter();
        const protocol=new SocketProtocol({onData:data.event,onClose:close.event,onEnd:close.event,write:buffer=>ws.send(buffer.buffer),end:()=>ws.close(),dispose:()=>ws.close(),drain:()=>Promise.resolve()});
        ws.on('message',bytes=>data.fire(VSBuffer.wrap(Buffer.from(bytes))));
        const client=new ChannelClient(protocol);clients.push({ws,client,protocol});
        return {ws,service:ProxyChannel.toService(client.getChannel('window'))};
      }
      const input={workspaces:[{workspacePath:'/B'},{workspacePath:'/A'}],sidebar:{organizeBy:'project',sortBy:'updated'}};
      const published=once(host,'message');host.postMessage({type:'publish',input});await published;
      const one=await connect();const two=await connect();
      assert.deepEqual((await one.service.getWorkspaceSession()).workspaces,input.workspaces);
      assert.equal((await two.service.getWorkspaceSession()).epoch,'native-existing-host');
      await assert.rejects(one.service.publishWorkspaceSession(input),/read-only/);
      assert.equal(await one.service.submit(),1);assert.equal(await two.service.total(),1);
      const retired=clients.map(({ws})=>once(ws,'close'));
      await invoke(false);await Promise.all(retired);
      for(const {client,protocol} of clients){client.dispose();protocol.dispose();}
      const baseline=host.listenerCount('exit');
      for(let n=0;n<3;n++){const next=await invoke(true);assert.equal(next.token,state.token);await invoke(false);}
      assert.equal(host.listenerCount('exit'),baseline,'Toggle does not accumulate Host listeners');
      await invoke(true);await manager.dispose();
      manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});
      await manager.restore(win);const restored=await readState();assert.equal(restored.enabled,true);assert.equal(restored.token,state.token);assert.deepEqual(restored.urls,state.urls);
      const other=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await other.loadURL('about:blank');hosts.set(other.webContents.id,host);await manager.restore(other);
      assert.equal((await other.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.GetDesktopLanAccess)+')')).enabled,false,'New windows are not implicitly exposed');
      await assert.rejects(other.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SetDesktopLanAccessEnabled)+',true)'),/another window/);
      await assert.rejects(other.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SetDesktopLanAccessEnabled)+',false)'),/another window/);
      await assert.rejects(other.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SaveDesktopLanAccessConfiguration)+','+JSON.stringify({...configuration,port:3031})+')'),/Disable LAN access/);
      other.destroy();
      await invoke(false);await manager.dispose();
      manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});await manager.restore(win);assert.equal((await readState()).enabled,false,'Explicit disable survives manager restart');
      await manager.dispose();
      // Existing config and pairing survive rejected schema and storage failures.
      manager=createManager({hosts,preference:{...preference,setConfiguration:async()=>{throw new Error('Synthetic configuration write failure')}},onError:error=>errors.push(String(error))});
      await assert.rejects(save({address:'http://codevori-test.local',port:3030}));
      await assert.rejects(save({...configuration,port:3031}),/Synthetic configuration write failure/);
      assert.deepEqual((await readState()).configuration,configuration);await manager.dispose();
      for(const broken of [
        {load:async()=>{throw new Error('Synthetic credential read failure')},save:credentials.save},
        {load:async()=>null,save:async()=>{throw new Error('Synthetic credential write failure')}},
        {load:async()=>'corrupt',save:credentials.save},
      ]){
        manager=registerDesktopLanAccess({hosts,preference,credentials:broken,onError:error=>errors.push(String(error))});
        await assert.rejects(invoke(true));assert.equal((await readState()).enabled,false);await manager.dispose();
      }
      // Restore read and a later disable share the same ordered operation path.
      let releaseRead;const readEntered=new Promise(resolve=>releaseRead=resolve);let finishRead;
      manager=createManager({hosts,preference:{...preference,getEnabled:()=>{releaseRead();return new Promise(resolve=>finishRead=resolve)}},onError:error=>errors.push(String(error))});
      const pendingRestore=manager.restore(win);await readEntered;
      const disable=invoke(false);finishRead(true);await pendingRestore;await disable;
      assert.equal((await readState()).enabled,false,'Late restore cannot override disable');await manager.dispose();
      // A failed persistence write must never leave a newly enabled endpoint open.
      manager=createManager({hosts,preference:{getEnabled:async()=>false,setEnabled:async()=>{throw new Error('Synthetic preference write failure')}},onError:error=>errors.push(String(error))});
      await assert.rejects(invoke(true),/Synthetic preference write failure/);assert.equal((await readState()).enabled,false);await manager.dispose();
      manager=createManager({hosts,preference:{getEnabled:async()=>true,setEnabled:async()=>{throw new Error('Synthetic disable persistence failure')}},onError:error=>errors.push(String(error))});
      await manager.restore(win);await assert.rejects(invoke(false),/Synthetic disable persistence failure/);assert.equal((await readState()).enabled,false,'Disable closes the listener even if saving fails');await manager.dispose();
      manager=createManager({hosts,preference:{getEnabled:async()=>{throw new Error('Synthetic preference read failure')},setEnabled:preference.setEnabled},onError:error=>errors.push(String(error))});
      await assert.rejects(manager.restore(win),/Synthetic preference read failure/);assert.equal((await readState()).enabled,false);await manager.dispose();
      // Closing a window while its preference is being read must not create a listener.
      const closing=new BrowserWindow({show:false});hosts.set(closing.webContents.id,host);
      let releaseClosedRead;let finishClosedRead;const closedReadEntered=new Promise(resolve=>releaseClosedRead=resolve);
      manager=createManager({hosts,preference:{getEnabled:()=>{releaseClosedRead();return new Promise(resolve=>finishClosedRead=resolve)},setEnabled:preference.setEnabled},onError:error=>errors.push(String(error))});
      const closingRestore=manager.restore(closing);await closedReadEntered;closing.destroy();finishClosedRead(true);await closingRestore;
      assert.equal(host.listenerCount('exit'),baseline);await manager.dispose();
      // Dispose cancels a pending real utilityProcess spawn wait without a timer.
      const unspawned=new (await import('node:events')).EventEmitter();
      hosts.set(win.webContents.id,unspawned);
      manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});
      const waitingSpawn=manager.restore(win);await manager.dispose();await waitingSpawn;
      assert.equal(unspawned.listenerCount('spawn'),0);assert.equal(unspawned.listenerCount('exit'),0);
      hosts.set(win.webContents.id,host);
      await preference.setEnabled(true);
      manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});
      hosts.set(win.webContents.id,unspawned);const obsoleteRestore=manager.restore(win);
      hosts.set(win.webContents.id,host);await manager.restore(win);
      assert.equal((await readState()).enabled,true,'New Host restore does not reuse old pending spawn');
      unspawned.emit('exit');await obsoleteRestore;await manager.dispose();
      manager=createManager({hosts,preference,onError:error=>errors.push(String(error))});
      const last=await invoke(true);const exit=once(host,'exit');host.kill();await exit;
      // IPC read waits for Host exit listeners without a polling timeout or new Host.
      const after=await win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.GetDesktopLanAccess)+')');
      assert.equal(after.enabled,false);assert.equal(last.enabled,true);
      const replacement=utilityProcess.fork(join(app.getAppPath(),'host.cjs'));hosts.set(win.webContents.id,replacement);
      const replacementReady=once(replacement,'message');const replacementRestore=manager.restore(win);await replacementReady;await replacementRestore;
      const resumed=await readState();assert.equal(resumed.enabled,true);assert.equal(resumed.token,last.token,'Host replacement preserves saved credentials');assert.deepEqual(resumed.urls,last.urls);
      await manager.dispose();replacement.kill();win.destroy();assert.deepEqual(errors,[]);
      writeSync(1,'LAN_NATIVE_PASS\\n');
    }
    main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1)});
  `,
  );
  const env = { ...process.env };
  env.ZCODE_DATA_BASE_DIR = join(root, "data");
  env.ZCODE_DESKTOP_HOME_DIR = root;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const result = await promisify(execFile)(requireDesktop("electron"), [appRoot], {
    env,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /LAN_NATIVE_PASS/, result.stderr);
  for (const phase of ["--restart-enabled", "--restart-disabled"]) {
    const restarted = await promisify(execFile)(requireDesktop("electron"), [appRoot, phase], {
      env,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    assert.match(restarted.stdout, /LAN_RESTART_PASS/, restarted.stderr);
  }
  console.log(
    "PASS native Main IPC → LAN gateway → MessagePort → existing utilityProcess Host; shared state, readonly projection, restart persistence, disable/restore ordering, preference failures, cleanup and Host exit",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
