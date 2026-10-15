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
      alias: { "@zcode/server": resolve(desktop, "../server/src/desktopLanGateway.ts") },
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
    import {app,BrowserWindow,utilityProcess} from 'electron';
    import {WebSocket} from 'ws';
    import {Emitter,VSBuffer,SocketProtocol,ChannelClient,ProxyChannel} from '@zcode/rpc';
    import {PlatformChannels} from '@zcode/shared';
    import {registerDesktopLanAccess} from './src/main/desktopLanAccess.ts';
    app.setPath('userData',join(${JSON.stringify(root)},'profile'));
    app.on('window-all-closed',()=>{});
    async function main(){
      await app.whenReady();
      const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
      await win.loadURL('about:blank');
      const host=utilityProcess.fork(join(app.getAppPath(),'host.cjs'));
      await once(host,'message');
      const hosts=new Map([[win.webContents.id,host]]);
      const errors=[];const manager=registerDesktopLanAccess({hosts,onError:error=>errors.push(String(error))});
      const invoke=(enabled)=>win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.SetDesktopLanAccessEnabled)+','+JSON.stringify(enabled)+')');
      const state=await invoke(true);assert.equal(state.enabled,true);
      const origin=state.urls[0];
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
      for(let n=0;n<3;n++){const next=await invoke(true);assert.notEqual(next.token,state.token);await invoke(false);}
      assert.equal(host.listenerCount('exit'),baseline,'Toggle does not accumulate Host listeners');
      const last=await invoke(true);const exit=once(host,'exit');host.kill();await exit;
      // IPC read waits for Host exit listeners without a polling timeout or new Host.
      const after=await win.webContents.executeJavaScript('require("electron").ipcRenderer.invoke('+JSON.stringify(PlatformChannels.GetDesktopLanAccess)+')');
      assert.equal(after.enabled,false);assert.equal(last.enabled,true);
      await manager.dispose();win.destroy();assert.deepEqual(errors,[]);
      writeSync(1,'LAN_NATIVE_PASS\\n');
    }
    main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1)});
  `,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const result = await promisify(execFile)(requireDesktop("electron"), [appRoot], {
    env,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert.match(result.stdout, /LAN_NATIVE_PASS/);
  console.log(
    "PASS native Main IPC → LAN gateway → MessagePort → existing utilityProcess Host; shared state, readonly projection, toggle and Host exit",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
