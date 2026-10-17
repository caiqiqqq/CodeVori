// Real Shell, sidebar button and Root draft action; synthetic Host, no Agent requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__sidebar-new-conversation-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue-191-"));
let server, browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useEffect,useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceShellLayout} from '../../../ui/src/app-shell/WorkspaceShellLayout.tsx';
    import {useConversationWorkspaceActions} from '../../../ui/src/root/useConversationWorkspaceActions.ts';
    import {useDesktopWindowView} from '../../../ui/src/root/desktopWindowSession.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {persistSidebarTaskPreferences} from '../../../ui/src/lib/sidebarTaskPreferences.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const project='/synthetic/project',conversation='/synthetic/tasks',noop=()=>{},subscribe=()=>()=>({dispose(){}});
    const state:any={ensured:0,fallback:0,writes:[],error:null,defer:false,fail:false};window.__newTask=state;window.__React=React;
    const forbidden=(op:string)=>()=>{state.writes.push(op);throw Error('Unexpected write: '+op)};
    const services:any={
      fileService:{ensureConversationWorkspace:async()=>{state.ensured++;if(state.fail)throw Error('Synthetic directory failure');if(state.defer)await new Promise(resolve=>state.resolve=resolve);return {path:conversation}}},
      settingService:{get:async()=>({}),onDynamicChanged:subscribe},
      gitService:{getWorkspaceRepositoryInfo:async(r:any)=>({...r,kind:'main-tree',repoRoot:r.workspacePath})},
      zcodeTaskService:{listTasks:async()=>[],listArchivedTasks:async()=>[],listPinnedTasks:async()=>[],listPinnedTaskIds:async()=>[],onDynamicWorkspaceEvent:subscribe},
      acpService:{listSummaries:async()=>[],onDynamicSessionSummaryChanged:subscribe,create:forbidden('acp-create')},
      workTaskService:{list:async()=>({tasks:[],concurrency:1}),onDynamicChanged:subscribe},
      windowControllerService:{onDynamicControllerFrame:subscribe,subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),unsubscribeControllerV4:async()=>{},listTaskList:async()=>({items:[],total:0,hasMore:false})},
    };
    for(const op of ['create','update','start','complete','merge'])services.workTaskService[op]=forbidden(op);
    persistSidebarTaskPreferences({organizeBy:'project',sortBy:'updated'});
    function Fixture(){
      const tabStore=useTabStoreApi(),tabs=useTabStore(s=>s.tabs),path=useTabStore(s=>s.activeWorkspacePath)||conversation;
      const active=useZCodeSessionStore(s=>s.getWorkspaceState(path).activeTaskId);
      const [view,setView]=useState('work-tasks'),[desktop,setDesktop]=useState(true),[locale,setLocale]=useState('zh-CN'),[callback,setCallback]=useState(true),[readOnly,setReadOnly]=useState(false);
      const ref=useRef(null);
      const actions=useConversationWorkspaceActions({services,addTab:tabStore.getState().addTab,setWorkspaceActionError:error=>state.error=error});
      state.prepare=({view='work-tasks',source=conversation,desktop=true,locale='zh-CN',callback=true,readOnly=false,following=false,defer=false,fail=false}={})=>{
        useDesktopWindowView.setState({following,snapshot:following?{workspaces:[{workspacePath:conversation,workspacePurpose:'conversation'}]}:null});
        tabStore.getState().addTab(source,{workspacePurpose:source===conversation?'conversation':'project'});
        useZCodeSessionStore.getState().setActiveTaskId(source,'old-session');
        setView(view);setDesktop(desktop);setLocale(locale);setCallback(callback);setReadOnly(readOnly);
        Object.assign(state,{ensured:0,fallback:0,error:null,defer,fail});
      };
      state.tabs=tabStore;state.sessions=useZCodeSessionStore;state.theme=applyTheme;
      useEffect(()=>{tabStore.getState().addTab(conversation,{workspacePurpose:'conversation'});useZCodeSessionStore.getState().setActiveTaskId(conversation,'old-session')},[]);
      return <ZCodeIntlProvider initialLocale={locale} key={locale}><TooltipProvider><div className='h-dvh' data-testid='navigation' data-view={view}>
        <WorkspaceShellLayout services={services} platform={{isWeb:true}} workspaceAbsPath={path} workspaceMainView={view} onWorkspaceMainViewChange={setView}
          workspaceTabs={tabs.filter(t=>t.kind==='workspace')} workspaceShellZCodeState={{draftFocusVersion:0,selectedProvider:'glm',activeTaskId:active}} theme='zai-light'
          activeTaskId={active} sidePaneOwnerId='fixture' projectName='Synthetic' isWorkspaceVisible isDesktop={desktop} isMacDesktop={false} isWindowsDesktop={false} isMacFullscreen={false}
          isSidebarVisible isTerminalOpen={false} isSidePaneOpen={false} isBrowserOpen={false} supportsEmbeddedBrowser={false} gitState={{summary:null,datasets:{staged:{sections:[]},unstaged:{sections:[]}}}}
          workspaceReadOnlyReason={readOnly?'Synthetic readonly':undefined} gitWorktreeChangeSummary={{added:0,removed:0}} summaryPanelVariantOverride={null}
          handleToggleSidebar={noop} handleToggleSidePane={noop} handleRefreshGit={noop} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop}
          commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop}
          reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}}
          onCreateTask={()=>{state.fallback++;useZCodeSessionStore.getState().startDraft(path)}} onCreateConversationTask={callback?actions.handleCreateConversationTask:undefined}
          onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} handleSelectTask={noop} handleStartDraftInWorkspace={noop}
          handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={noop} handleOpenWorkTasks={noop}
          updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={0} sidebarContainerRef={ref} taskFindDialogProps={{}}
          taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}/>
      </div></TooltipProvider></ZCodeIntlProvider>;
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "error",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Synthetic directory failure"))
      errors.push(message.text());
  });
  const stub = (path, body) =>
    page.route(`**/packages/ui/src/${path}*`, (route) =>
      route.fulfill({ contentType: "application/javascript", body }),
    );
  // Only unrelated content/read projections are replaced; the real sidebar owns the clicked button.
  for (const [path, symbol] of [
    ["WorkspaceHeader.tsx", "WorkspaceHeader"],
    ["DesktopTopOverlay.tsx", "DesktopTopOverlay"],
    ["WorkspaceSidebarFooter.tsx", "WorkspaceSidebarFooter"],
    ["WorkspacePinnedTasksSection.tsx", "WorkspacePinnedTasksSection"],
    ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
    ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
    ["work-tasks/WorkTasksPanel.tsx", "WorkTasksPanel"],
    ["repository-panel/RepositoryPanel.tsx", "RepositoryPanel"],
    ["settings/PluginStorePage.tsx", "PluginStorePage"],
  ])
    await stub(path, `export function ${symbol}(){return null}`);
  await stub(
    "WorkspaceTimelineTasksSection.tsx",
    `export function WorkspaceTimelineTasksSection(p){return window.__React.createElement('button',{'data-testid':'old-acp',onClick:()=>p.onSelectAcpSession({id:'old-acp',agent:'codex',workspacePath:'/synthetic/tasks'})},'Old ACP')}`,
  );
  await stub(
    "settings/AutomationsSection.tsx",
    `export const AUTOMATIONS_TOAST_ANCHOR_ID='fixture-automations';export function AutomationsSection(){return null}`,
  );
  await stub(
    "v4/V4WorkspaceChatArea.tsx",
    `export function V4WorkspaceChatArea(p){return window.__React.createElement('textarea',{'data-testid':'new-task-draft','data-workspace':p.workspacePath,'data-session':p.sessionId??'','data-acp-request':p.acpOpenRequest?.session.id??'',placeholder:'Independent task draft'})}`,
  );
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const button = page.getByTestId("conversation-new-task");
  await button.waitFor().catch((error) => {
    throw Error(errors.join("\n") || error.message);
  });
  const prepare = async (options) => {
    await page.evaluate((options) => window.__newTask.prepare(options), options);
    await page.waitForFunction(
      (view) => document.querySelector("[data-testid=navigation]")?.dataset.view === view,
      options.view ?? "work-tasks",
    );
    await page.getByTestId("conversation-section").hover();
  };
  const assertDraft = async (path = "/synthetic/tasks") => {
    await page.waitForFunction((path) => {
      const s = window.__newTask;
      return (
        document.querySelector("[data-testid=navigation]")?.dataset.view === "chat" &&
        s.tabs.getState().activeWorkspacePath === path &&
        s.sessions.getState().getWorkspaceState(path).activeTaskId === null
      );
    }, path);
    await page.getByTestId("new-task-draft").waitFor({ state: "attached" });
    assert.equal(await page.getByTestId("new-task-draft").getAttribute("data-workspace"), path);
    assert.equal(await page.getByTestId("new-task-draft").getAttribute("data-session"), "");
    assert.equal(await page.getByTestId("new-task-draft").getAttribute("data-acp-request"), "");
  };
  for (const [width, desktop, locale, theme] of [
    [1440, true, "zh-CN", "zai-light"],
    [390, false, "en-US", "zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await prepare({ desktop, locale, following: !desktop });
    await page.evaluate((theme) => window.__newTask.theme(theme), theme);
    await button.click();
    await page.waitForFunction(
      () =>
        window.__newTask.sessions.getState().getWorkspaceState("/synthetic/tasks").activeTaskId ===
        null,
    );
    await page.screenshot({ path: join(artifacts, `${width}-after-click.png`) });
    assert.equal(
      await page.getByTestId("navigation").getAttribute("data-view"),
      "chat",
      "new independent draft must be visible after clicking the real sidebar button",
    );
    await assertDraft();
    assert.equal(await page.evaluate(() => window.__newTask.ensured), desktop ? 1 : 0);
    await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare({ view: "chat" });
  await page.getByTestId("old-acp").first().click();
  await page.waitForFunction(
    () => document.querySelector("[data-testid=new-task-draft]")?.dataset.acpRequest === "old-acp",
  );
  await prepare({});
  await button.click();
  await assertDraft();
  for (const view of ["work-tasks", "repository", "plugin-store", "automations"]) {
    await prepare({ view, source: "/synthetic/project", readOnly: true });
    await button.click();
    await assertDraft();
  }
  await prepare({ defer: true });
  await button.click();
  await page.waitForFunction(() => Boolean(window.__newTask.resolve));
  assert.equal(await page.getByTestId("navigation").getAttribute("data-view"), "chat");
  await page.evaluate(() => window.__newTask.resolve());
  await assertDraft();
  await prepare({ source: "/synthetic/project", fail: true });
  await button.click();
  await page.waitForFunction(() => window.__newTask.error === "Synthetic directory failure");
  assert.equal(
    await page.evaluate(() => window.__newTask.tabs.getState().activeWorkspacePath),
    "/synthetic/project",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__newTask.sessions.getState().getWorkspaceState("/synthetic/project").activeTaskId,
    ),
    "old-session",
  );
  await prepare({ callback: false });
  await button.click();
  await assertDraft();
  assert.equal(await page.evaluate(() => window.__newTask.fallback), 1);
  await prepare({ callback: false, readOnly: true });
  await button.click();
  assert.equal(await page.evaluate(() => window.__newTask.fallback), 0);
  assert.equal(await page.getByTestId("navigation").getAttribute("data-view"), "work-tasks");
  assert.deepEqual(await page.evaluate(() => window.__newTask.writes), []);
  assert.deepEqual(errors, []);
  console.log(
    `PASS issue #191: real sidebar navigation, Root draft, delayed/failed resolution, readonly/fallback, desktop/mobile; screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html, moduleFile].map((path) => rm(path, { force: true })));
}
