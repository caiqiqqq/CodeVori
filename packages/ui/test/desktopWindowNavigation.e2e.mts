// Real Root projection, navigation hooks and Zustand; synthetic Host indexes, no Agent starts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__desktop-navigation-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {TabStoreProvider,useTabStoreApi,useTabStore} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {useDesktopWindowSession} from '../../../ui/src/root/useDesktopWindowSession.ts';
    import {useDesktopWindowNavigation} from '../../../ui/src/hooks/useDesktopWindowNavigation.ts';
    import {useDesktopWindowView} from '../../../ui/src/root/desktopWindowSession.ts';
    import {readDesktopWindowNavigation} from '../../../ui/src/lib/desktopWindowNavigation.ts';
    const query=new URLSearchParams(location.search);let release;const hold=query.has('hold')?new Promise(resolve=>release=resolve):Promise.resolve();
    const state={calls:[],restores:[],held:false,snapshot:{epoch:'host',revision:1,workspaces:[{workspacePath:'/conversation',workspacePurpose:'conversation'},{workspacePath:'/same',workspaceIdentity:'remote-A',remoteSessionId:'attachment-new'},{workspacePath:'/same',workspaceIdentity:'remote-B',remoteSessionId:'attachment-B'}],sidebar:{organizeBy:'project',sortBy:'updated'}},listener:null};
    const acp={id:'acp-saved',agent:'codex',title:'ACP Saved',workspacePath:'/conversation',entries:[{kind:'user',createdAt:10}],history:{createdAt:10,updatedAt:20},status:'idle'};
    const indexServices=label=>({zcodeSessionService:{listSessions:async input=>{state.calls.push({label,input});state.held=true;await hold;if(query.has('offline'))throw Error('offline');if(query.has('missing'))return [];return [{sessionId:input.sessionIds[0],workspace:{workspacePath:input.workspacePath,workspaceIdentity:input.workspaceIdentity,workspaceKey:input.workspaceIdentity||input.workspacePath},...(query.has('archived')?{archivedAt:10}:{})}]}},acpService:{listSummaries:async()=>{state.calls.push({label,acp:true});return query.has('missing')?[]:[acp]}}});
    const services={...indexServices('base'),windowControllerService:{getWorkspaceSession:async()=>state.snapshot,onDynamicWorkspaceSessionChanged:()=>listener=>{state.listener=listener;return{dispose(){state.listener=null}}}}};
    const follower={prepare:async snapshot=>{for(const workspace of snapshot.workspaces)if(workspace.remoteSessionId)useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:workspace.remoteSessionId,services:indexServices(workspace.workspaceIdentity)})}};
    function Navigation({tab}){
      const sessions=useZCodeSessionStore(s=>s.getWorkspaceState(tab.workspacePath,tab.workspaceIdentity));
      const [selectedAcp,setAcp]=useState(null);
      const selectApi=(path,id,identity)=>{state.restores.push({kind:'api',id});setAcp(null);useZCodeSessionStore.getState().setActiveTaskId(path,id,identity)};
      const selectAcp=session=>{state.restores.push({kind:'acp',id:session.id});useZCodeSessionStore.getState().setActiveTaskId(tab.workspacePath,null,tab.workspaceIdentity);setAcp(session)};
      useDesktopWindowNavigation({workspacePath:tab.workspacePath,workspaceIdentity:tab.workspaceIdentity,activeSessionId:sessions.activeTaskId,acpSession:selectedAcp,chatVisible:true,draftFocusVersion:sessions.draftFocusVersion,selectApi,selectAcp});
      return <section><output data-testid='location' data-workspace={tab.workspaceIdentity||tab.workspacePath} data-native={sessions.activeTaskId||''}>{sessions.activeTaskId||selectedAcp?.id||'draft'}</output>
        <button onClick={()=>selectApi(tab.workspacePath,'api-saved',tab.workspaceIdentity)}>打开 API</button>
        <button onClick={()=>selectAcp({...acp,workspacePath:tab.workspacePath,workspaceIdentity:tab.workspaceIdentity})}>打开 ACP</button>
        <button onClick={()=>{setAcp(null);useZCodeSessionStore.getState().startDraft(tab.workspacePath,undefined,tab.workspaceIdentity)}}>新建对话</button>
      </section>;
    }
    function Fixture(){
      const store=useTabStoreApi();const tabs=useTabStore(s=>s.tabs);const active=useTabStore(s=>s.activeTabId);const tab=tabs.find(tab=>tab.id===active);
      const result=useDesktopWindowSession({services:services as never,ready:true,follower});
      window.__navigation={state,store,sessions:useZCodeSessionStore,bookmark:readDesktopWindowNavigation,release:()=>release?.(),emit:snapshot=>{state.snapshot=snapshot;state.listener(snapshot)}};
      if(result.error)return <p role='alert'>{result.error}</p>;if(result.loading)return <p>连接中</p>;
      return <main><nav>{tabs.map(item=><button key={item.id} onClick={()=>store.getState().activateTab(item.id)}>{item.workspaceIdentity||item.workspacePath}</button>)}</nav>{tab?<Navigation key={tab.id} tab={tab}/>:<p>选择工作区</p>}</main>;
    }
    createRoot(document.getElementById('root')!).render(<TabStoreProvider><Fixture/></TabStoreProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 5197, strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "error",
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw Error("Missing E2E server port");
  const url = `http://127.0.0.1:${address.port}/${name}.html`;
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const errors: string[] = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    let page = await context.newPage();
    await page.goto(url);
    const expectLocation = async (id: string, workspace = "/conversation") => {
      await page.waitForFunction(
        ({ id, workspace }) => {
          const output = document.querySelector('[data-testid="location"]');
          return output?.textContent === id && output.getAttribute("data-workspace") === workspace;
        },
        { id, workspace },
      );
    };
    const reopen = async (suffix = "") => {
      await page.close();
      page = await context.newPage();
      await page.goto(url + suffix);
    };
    await expectLocation("draft");
    await page.getByRole("button", { name: "打开 API", exact: true }).click();
    await expectLocation("api-saved");
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "api");
    await reopen();
    await expectLocation("api-saved");
    assert.deepEqual(await page.evaluate(() => window.__navigation.state.restores), [
      { kind: "api", id: "api-saved" },
    ]);
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "draft");
    await page.reload();
    await expectLocation("draft");
    await page.getByRole("button", { name: "打开 ACP", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "acp");
    await reopen();
    await expectLocation("acp-saved");
    assert.equal(await page.getByTestId("location").getAttribute("data-native"), "");
    assert.deepEqual(await page.evaluate(() => window.__navigation.state.restores), [
      { kind: "acp", id: "acp-saved" },
    ]);
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "draft");
    await reopen();
    await expectLocation("draft");
    // Switching to a remote scope with an identical path must restore by identity/current attachment.
    await page.getByRole("button", { name: "remote-B", exact: true }).click();
    await page.getByRole("button", { name: "打开 API", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__navigation.bookmark()?.workspaceIdentity === "remote-B" &&
        window.__navigation.bookmark()?.target.kind === "api",
    );
    await reopen();
    await expectLocation("api-saved", "remote-B");
    assert.equal(await page.evaluate(() => window.__navigation.state.calls[0].label), "remote-B");
    assert.equal(
      await page.evaluate(() => window.__navigation.state.calls[0].input.remoteSessionId),
      "attachment-B",
    );
    // Snapshot revocation while validation is pending must defeat the late lookup result.
    await reopen("?hold=1");
    await page.waitForFunction(() => window.__navigation.state.held);
    await page.evaluate(() => {
      const state = window.__navigation.state;
      window.__navigation.emit({
        ...state.snapshot,
        revision: 2,
        workspaces: state.snapshot.workspaces.filter(
          (item) => item.workspaceIdentity !== "remote-B",
        ),
      });
      window.__navigation.release();
    });
    await expectLocation("draft");
    assert.deepEqual(await page.evaluate(() => window.__navigation.state.restores), []);
    // Explicit navigation during an outstanding startup read wins.
    await page.getByRole("button", { name: "打开 API", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "api");
    await reopen("?hold=1");
    await page.waitForFunction(() => window.__navigation.state.held);
    await page.evaluate(() => {
      window.__navigation.sessions.getState().startDraft("/conversation");
      window.__navigation.release();
    });
    await expectLocation("draft");
    assert.deepEqual(await page.evaluate(() => window.__navigation.state.restores), []);
    // Missing/archived history falls back; a network error retains the bookmark for retry.
    await page.getByRole("button", { name: "打开 API", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "api");
    await reopen("?offline=1");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.__navigation.bookmark()?.target.kind), "api");
    await reopen("?archived=1");
    await expectLocation("draft");
    await page.getByRole("button", { name: "打开 ACP", exact: true }).click();
    await page.waitForFunction(() => window.__navigation.bookmark()?.target.kind === "acp");
    await reopen("?missing=1");
    await expectLocation("draft");
    await page.screenshot({ path: `/tmp/zcode-76e2-navigation-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: mobile/desktop widths, API/ACP close-and-reopen, explicit drafts, identity/attachment routing, revoked scopes, stale reads, user navigation, offline and deleted/archived fallback.",
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
