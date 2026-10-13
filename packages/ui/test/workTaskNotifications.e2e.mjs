// pnpm exec tsx packages/ui/test/workTaskNotifications.e2e.mjs
// Production window observer, shared reads, preferences and navigation; synthetic Hosts only.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__work-task-notifications-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let server;
let browser;
try {
  await writeFile(
    html,
    `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkTaskNotifications} from '../../../ui/src/work-tasks/WorkTaskNotifications.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider,useZCodeStore} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {useRemoteWorkspaceSessionStore as remote} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {getWorkTaskReadModel} from '../../../ui/src/hooks/workTaskReadModel.ts';
    import {useWorktreeSettingsConversation} from '../../../ui/src/hooks/useWorktreeSettingsConversation.ts';
    import {workTaskNavigationStore} from '../../../ui/src/store/workTaskNavigationStore.ts';
    import {playTaskNotificationSound} from '../../../ui/src/lib/taskNotificationSound.ts';
    const state:any={calls:[],notifications:[],navigations:[],clicks:new Set(),listeners:[],rows:{},pending:[],fail:null,defer:null,audio:0,focused:false};
    window.__fixture=state;
    window.Audio=class{pause(){}play(){state.audio++;return Promise.resolve()}} as never;
    const key=(scope:any)=>scope.workspaceIdentity?.trim()||scope.workspacePath;
    const service=(host:string)=>({
      async list(scope:any){const k=host+key(scope);state.calls.push({op:'list',host,...scope});if(state.fail===k)throw Error('Synthetic disconnected');const value=structuredClone({tasks:state.rows[k]||[],concurrency:1});if(state.defer===k){state.defer=null;return new Promise(resolve=>state.pending.push(()=>resolve(value)))}return value},
      onDynamicChanged:(scope:any)=>(fn:any)=>{const item={host,scope,fn,live:true};state.listeners.push(item);return {dispose(){item.live=false}}},
      start(){throw Error('No business writes')},create(){throw Error('No Agent requests')},
    });
    const local=service('local'),a=service('a'),b=service('b');
    const services:any={workTaskService:local,gitService:{async getWorkspaceRepositoryInfo({workspacePath}){return {workspacePath,kind:'main-tree',repoRoot:workspacePath,isGitAvailable:true}}}};
    remote.getState().registerBaseServices(services);
    state.connect=(id='a')=>{remote.getState().registerSession({sessionId:id,services:{workTaskService:id==='a'?a:b}});remote.getState().bindWorkspaceIdentity('remote:'+id,id)};
    state.disconnect=(id)=>remote.getState().unregisterSession(id);state.connect('a');state.connect('b');
    const project=(workspacePath,extra={})=>({id:workspacePath+JSON.stringify(extra),kind:'workspace',workspacePath,label:workspacePath,workspacePurpose:'project',...extra});
    const projects=[project('/one'),project('/two'),project('/one'),project('/conversation',{workspacePurpose:'conversation'}),project('/shared',{workspaceIdentity:'remote:a',remoteSessionId:'a'}),project('/shared',{workspaceIdentity:'remote:b',remoteSessionId:'b'})];
    state.projects=projects;
    const task=(status,kind='api',patch={})=>({id:'same',title:kind==='api'?'后台 API 待办':'后台 ACP 待办',status,execution:{kind},workspacePath:'/host',runSeq:1,updatedAt:1,archived:false,stopPending:false,...patch});
    state.task=task;state.rows['local/one']=[task('running')];state.rows['local/two']=[task('running','acp')];state.rows['aremote:a']=[task('awaiting_input')];state.rows['bremote:b']=[task('running','acp')];
    state.emit=(host,k,patch)=>{const row=state.rows[host+k][0];Object.assign(row,{updatedAt:row.updatedAt+1},patch);state.notify(host,k)};
    state.notify=(host,k)=>{for(const x of state.listeners)if(x.live&&x.host===host&&key(x.scope)===k)x.fn()};
    state.click=(id)=>{for(const fn of state.clicks)fn(id)};
    state.finish=()=>state.pending.shift()?.();
    const platform:any={showTaskNotification(payload){if(state.focused)return;state.notifications.push(payload);void playTaskNotificationSound()},onTaskNotificationClick(fn){state.clicks.add(fn);return ()=>state.clicks.delete(fn)}};
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    function Fixture(){const [tabs,setTabs]=useState(projects),[epoch,setEpoch]=useState(0);const api=useTabStoreApi();const {setLocalePreference}=useZCodeIntl();const store=useZCodeStore(s=>s);state.locale=setLocalePreference;state.setProjects=setTabs;state.remount=()=>setEpoch(x=>x+1);state.settings={getState:()=>store};state.tabState=()=>api.getState();state.selection=()=>workTaskNavigationStore.getState();state.opened=[];
      state.resetTabs=()=>api.setState({tabs:projects,activeTabId:projects[0].id});
      useWorktreeSettingsConversation({selectApi(){throw Error('Must open work task')},selectAcp(){throw Error('Must open work task')},openWorkTasks(scope){state.navigations.push({...scope,selection:state.selection().tasks})}});
      state.share=()=>{const r=getWorkTaskReadModel(local,{workspacePath:'/one'},false);state.unshare=r.subscribe(()=>{})};
      return <><button id='notifications' onClick={()=>store.setNotificationEnabled(!store.notificationEnabled)}>notifications</button><button id='sound' onClick={()=>store.setNotificationSoundEnabled(!store.notificationSoundEnabled)}>sound</button><span id='ready'>ready</span><WorkTaskNotifications key={epoch} projects={tabs}/></>}
    createRoot(document.getElementById('root')!).render(<React.StrictMode><ServiceProvider services={services}><PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale='zh-CN'><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></ZCodeIntlProvider></PlatformProvider></ServiceProvider></React.StrictMode>);
  `,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`, {
      timeout: 120000,
      waitUntil: "domcontentloaded",
    });
    const settled = () =>
      page.waitForFunction(() => window.__fixture.listeners.filter((x) => x.live).length === 4);
    await settled();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__fixture.resetTabs();
      window.__fixture.settings.getState().setNotificationEnabled(true);
      window.__fixture.settings.getState().setNotificationSoundEnabled(true);
    });
    const count = () => page.evaluate(() => window.__fixture.notifications.length);
    const emit = async (host, k, patch) => {
      await page.evaluate(({ host, k, patch }) => window.__fixture.emit(host, k, patch), {
        host,
        k,
        patch,
      });
      await page.waitForTimeout(70);
    };
    assert.equal(await count(), 0, "existing remote wait is a baseline");
    const reads = await page.evaluate(() => window.__fixture.calls.length);
    await page.evaluate(() => window.__fixture.share());
    assert.equal(
      await page.evaluate(() => window.__fixture.calls.length),
      reads,
      "notification observer shares the list with other consumers",
    );
    await emit("local", "/one", { status: "awaiting_input" });
    await emit("local", "/two", {
      status: "awaiting_input",
      merge: { phase: "awaiting_input", id: "merge" },
    });
    assert.equal(await count(), 2);
    assert.equal(await page.evaluate(() => window.__fixture.audio), 2);
    const [api, acp] = await page.evaluate(() => window.__fixture.notifications);
    assert.equal(api.title, "任务等待你的确认");
    assert.match(acp.body, /后台 ACP 待办/);
    assert.notEqual(api.taskId, acp.taskId);
    await page.evaluate((id) => window.__fixture.click(id), api.taskId);
    assert.equal(
      await page.evaluate(() => window.__fixture.navigations.at(-1).workspacePath),
      "/one",
    );
    await emit("local", "/one", { title: "renamed" });
    assert.equal(await count(), 2);
    await page.locator("#sound").click();
    await emit("local", "/one", { status: "running" });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), 3);
    assert.equal(await page.evaluate(() => window.__fixture.audio), 2);
    await page.evaluate(() => (window.__fixture.focused = true));
    await emit("local", "/one", { status: "running" });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), 3);
    await page.evaluate(() => (window.__fixture.focused = false));
    await emit("local", "/one", { status: "running" });
    const navs = await page.evaluate(() => window.__fixture.navigations.length);
    await page.evaluate((id) => window.__fixture.click(id), api.taskId);
    assert.equal(
      await page.evaluate(() => window.__fixture.navigations.length),
      navs,
      "resolved clicks are ignored",
    );
    await emit("local", "/one", { status: "awaiting_input", stopPending: true });
    assert.equal(await count(), 3);
    await emit("local", "/one", { status: "running", stopPending: false });
    await emit("local", "/one", { status: "awaiting_input", archived: true });
    assert.equal(await count(), 3);
    await page.locator("#notifications").click();
    await page.waitForFunction(() => window.__fixture.listeners.filter((x) => x.live).length === 1);
    await emit("local", "/one", { status: "running", archived: false });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), 3);
    await page.locator("#notifications").click();
    await settled();
    await page.waitForTimeout(70);
    assert.equal(await count(), 3, "enabling with a shared cached wait remains a baseline");
    await page.evaluate(() => window.__fixture.locale("en-US"));
    await emit("b", "remote:b", { status: "awaiting_input" });
    assert.equal(await count(), 4);
    const remotePayload = await page.evaluate(() => window.__fixture.notifications.at(-1));
    assert.equal(remotePayload.title, "Task waiting for your confirmation");
    await page.evaluate((id) => window.__fixture.click(id), remotePayload.taskId);
    const nav = await page.evaluate(() => window.__fixture.navigations.at(-1));
    assert.equal(nav.workspaceIdentity, "remote:b");
    assert.equal(nav.remoteSessionId, "b");
    assert.equal(
      await page.evaluate(() => window.__fixture.tabState().activeTabId),
      "/shared" + JSON.stringify({ workspaceIdentity: "remote:b", remoteSessionId: "b" }),
    );
    const before = await count();
    await page.evaluate(() => window.__fixture.disconnect("b"));
    await page.waitForFunction(() => window.__fixture.listeners.filter((x) => x.live).length === 3);
    await page.evaluate((id) => window.__fixture.click(id), remotePayload.taskId);
    assert.equal(await page.evaluate(() => window.__fixture.navigations.length), navs + 1);
    await page.evaluate(() => window.__fixture.connect("b"));
    await settled();
    await page.waitForTimeout(70);
    assert.equal(await count(), before, "reconnect wait is a baseline");
    await page.evaluate(() => (window.__fixture.fail = "local/one"));
    await emit("local", "/one", { status: "running" });
    await page.evaluate(() => (window.__fixture.fail = null));
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), before, "error recovery is a baseline");
    await emit("local", "/one", { status: "running" });
    await page.evaluate(() => (window.__fixture.defer = "local/one"));
    await emit("local", "/one", { title: "late" });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), before + 1);
    await page.evaluate(() => window.__fixture.finish());
    await page.waitForTimeout(70);
    assert.equal(await count(), before + 1, "late running result cannot undo the edge");
    await page.evaluate(() => {
      window.__fixture.unshare();
      window.__fixture.setProjects(
        window.__fixture.projects.filter((x) => x.workspacePath !== "/one"),
      );
    });
    await page.waitForFunction(() => window.__fixture.listeners.filter((x) => x.live).length === 3);
    await emit("local", "/one", { status: "running" });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), before + 1);
    await page.evaluate(() => window.__fixture.setProjects(window.__fixture.projects));
    await settled();
    await page.waitForTimeout(70);
    assert.equal(await count(), before + 1, "reopened project waits do not replay");
    // A new run first seen waiting cannot replay; its later observed wait can notify.
    const oldRunPayload = await page.evaluate(() => window.__fixture.notifications.at(-1));
    await emit("local", "/one", { runSeq: 2 });
    assert.equal(await count(), before + 1);
    await emit("local", "/one", { status: "running" });
    await emit("local", "/one", { status: "awaiting_input" });
    assert.equal(await count(), before + 2);
    const nextRunPayload = await page.evaluate(() => window.__fixture.notifications.at(-1));
    assert.notEqual(oldRunPayload.taskId, nextRunPayload.taskId);
    const currentNavs = await page.evaluate(() => window.__fixture.navigations.length);
    await page.evaluate((id) => window.__fixture.click(id), oldRunPayload.taskId);
    assert.equal(await page.evaluate(() => window.__fixture.navigations.length), currentNavs);
    // Removing a remote tab cannot recreate it as a local project at the same path.
    await emit("b", "remote:b", { status: "running" });
    await emit("b", "remote:b", { status: "awaiting_input" });
    const staleRemote = await page.evaluate(() => window.__fixture.notifications.at(-1));
    await page.evaluate(() => {
      const api = window.__fixture.tabState();
      // The fixture exposes the actual store through resetTabs and tabState; remove using its action.
      api.closeTab(
        "/shared" + JSON.stringify({ workspaceIdentity: "remote:b", remoteSessionId: "b" }),
      );
    });
    await page.evaluate((id) => window.__fixture.click(id), staleRemote.taskId);
    assert.equal(await page.evaluate(() => window.__fixture.navigations.length), currentNavs);
    assert.equal(
      await page.evaluate(() =>
        window.__fixture
          .tabState()
          .tabs.some((tab) => tab.workspacePath === "/shared" && !tab.workspaceIdentity),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: desktop/320px API/ACP background and merge waits, scoped click navigation, shared reads, preferences/focus, initial/reconnect/error/reopen baselines and stale read isolation\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
