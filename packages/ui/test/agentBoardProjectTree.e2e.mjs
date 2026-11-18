// Real Shell, action rail, project/task tree and Agent board; isolated Host, no Agent requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__agent-board-project-tree-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = resolve(
  process.env.ZCODE_E2E_SCREENSHOT_DIR ??
    "packages/desktop/.e2e-artifacts/agent-board-project-tree",
);
let server, browser;
try {
  await mkdir(artifacts, { recursive: true });
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
    import {useWorkspaceTaskNavigation} from '../../../ui/src/app-shell/useWorkspaceTaskNavigation.ts';
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
    const project='/synthetic/project',other='/synthetic/other',noop=()=>{},subscribe=()=>()=>({dispose(){}});
    const state:any={writes:[],selections:[],theme:applyTheme};window.__tree=state;window.__React=React;
    const now=Date.now();
    const native={taskId:'native-tree',workspacePath:project,title:'Existing Native task',provider:'glm',status:'idle',model:'fixture-model',createdAt:now,updatedAt:now};
    const acp={id:'acp-tree',acpSessionId:'fixture-acp',agent:'codex',title:'Existing ACP task',workspacePath:project,status:'idle',revision:1,createdAt:now,updatedAt:now,entries:[{kind:'user',text:'Fixture task',createdAt:now}]};
    const forbidden=(op:string)=>()=>{state.writes.push(op);throw Error('Unexpected task write: '+op)};
    const services:any={
      settingService:{get:async()=>({}),onDynamicChanged:subscribe},
      gitService:{getWorkspaceRepositoryInfo:async(r:any)=>({...r,kind:'main-tree',repoRoot:r.workspacePath})},
      zcodeTaskService:{listTasks:async(scope:any)=>scope.workspacePath===project?[native]:[],listArchivedTasks:async()=>[],listDeletedTaskIds:async()=>[],listPinnedTasks:async()=>[],listPinnedTaskIds:async()=>[],onDynamicWorkspaceEvent:subscribe,
        listGroupedTaskViewStructure:async()=>({groups:[{id:'fixture-group',title:'Shared task group',color:'blue',createdAt:now,updatedAt:now}],members:[{groupId:'fixture-group',workspaceKey:project,workspacePath:project,taskId:native.taskId,sortOrder:1,addedAt:now}],topLevelOrders:[]})},
      acpService:{listSummaries:async(scope:any)=>scope.workspacePath===project?[acp]:[],onDynamicSessionSummaryChanged:subscribe,create:forbidden('acp-create')},
      workTaskService:{list:async()=>({tasks:[],concurrency:1}),onDynamicChanged:subscribe,getRepositoryIssueSummary:async()=>({pending:0,checkedAt:now,incomplete:false})},
      windowControllerService:{onDynamicControllerFrame:subscribe,subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),unsubscribeControllerV4:async()=>{},listTaskList:async(query:any)=>{const items=query.kind==='timeline'?[native].filter(t=>query.workspaceScopes.some((s:any)=>s.workspacePath===t.workspacePath)):[];return {items,total:items.length,hasMore:false}}},
    };
    for(const op of ['create','update','start','complete','merge'])services.workTaskService[op]=forbidden(op);
    persistSidebarTaskPreferences({organizeBy:'project',sortBy:'updated'});
    function Fixture(){
      const tabStore=useTabStoreApi(),tabs=useTabStore(s=>s.tabs),path=useTabStore(s=>s.activeWorkspacePath)||project;
      const active=useZCodeSessionStore(s=>s.getWorkspaceState(path).activeTaskId);
      const [view,setView]=useState('repository'),[ready,setReady]=useState(false);
      const ref=useRef(null);
      const nav=useWorkspaceTaskNavigation({intl:{formatMessage:({id}:any)=>id},workspaceAbsPath:path,activateTabByPath:tabStore.getState().activateTabByPath,onNavigateToAgentBoard:()=>setView('agent-board')});
      state.tabs=tabStore;
      useEffect(()=>{
        tabStore.setState({tabs:[{id:'project',kind:'workspace',label:'Project tree',workspacePath:project,workspacePurpose:'project'},{id:'other',kind:'workspace',label:'Other project',workspacePath:other,workspacePurpose:'project'}],activeTabId:'project',activeWorkspacePath:project,expandedWorkspacePaths:new Set([project,other])});
        useZCodeSessionStore.getState().setActiveTaskId(project,'native-tree');setReady(true);
      },[]);
      return ready?<div className='h-dvh bg-sidebar text-foreground' data-testid='tree-navigation' data-view={view}>
        <WorkspaceShellLayout services={services} platform={{isWeb:true}} workspaceAbsPath={path} workspaceMainView={view} onWorkspaceMainViewChange={setView}
          workspaceTabs={tabs.filter(t=>t.kind==='workspace')} workspaceShellZCodeState={{draftFocusVersion:0,selectedProvider:'glm',activeTaskId:active}} theme='zai-light'
          activeTaskId={active} sidePaneOwnerId='tree-fixture' projectName='Synthetic' isWorkspaceVisible isDesktop={innerWidth>768} isMacDesktop={innerWidth>768} isWindowsDesktop={false} isMacFullscreen={false}
          isSidebarVisible isTerminalOpen={false} isSidePaneOpen={false} isBrowserOpen={false} supportsEmbeddedBrowser={false} gitState={{summary:null,datasets:{staged:{sections:[]},unstaged:{sections:[]}}}}
          gitWorktreeChangeSummary={{added:0,removed:0}} summaryPanelVariantOverride={null}
          handleToggleSidebar={noop} handleToggleSidePane={noop} handleRefreshGit={noop} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop}
          commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop}
          reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}}
          onCreateTask={forbidden('new-task')} onCreateConversationTask={forbidden('new-conversation')}
          onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop}
          handleSelectTask={(scope:string,id:string)=>{state.selections.push([scope,id]);useZCodeSessionStore.getState().setActiveTaskId(scope,id)}}
          handleStartDraftInWorkspace={(scope:string)=>useZCodeSessionStore.getState().startDraft(scope)}
          handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={()=>setView('repository')} handleOpenAgentBoard={nav.handleOpenAgentBoard} handleOpenWorkTasks={()=>setView('work-tasks')}
          updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={0} sidebarContainerRef={ref} taskFindDialogProps={{}}
          taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}/>
      </div>:null;
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider initialLocale={new URLSearchParams(location.search).get('locale')??'zh-CN'}><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
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
  for (const [width, locale, theme] of [
    [1440, "zh-CN", "zai-light"],
    [1440, "zh-CN", "zai-dark"],
    [1440, "en-US", "zai-dark"],
    [390, "zh-CN", "zai-dark"],
    [390, "en-US", "zai-light"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // 看板必须真实渲染，避免占位主区域和裁剪截图掩盖当前双栏布局。
    for (const [path, symbol] of [
      ["WorkspaceHeader.tsx", "WorkspaceHeader"],
      ["WorkspaceSidebarFooter.tsx", "WorkspaceSidebarFooter"],
      ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
      ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
      ["work-tasks/WorkTasksPanel.tsx", "WorkTasksPanel"],
      ["repository-panel/RepositoryPanel.tsx", "RepositoryPanel"],
      ["settings/PluginStorePage.tsx", "PluginStorePage"],
    ])
      await page.route(`**/packages/ui/src/${path}*`, (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: ["RepositoryPanel", "WorkTasksPanel"].includes(symbol)
            ? `export function ${symbol}(){return window.__React.createElement('main',{'data-testid':'${symbol}'},'${symbol}')}`
            : `export function ${symbol}(){return null}`,
        }),
      );
    await page.route("**/packages/ui/src/settings/AutomationsSection.tsx*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const AUTOMATIONS_TOAST_ANCHOR_ID='tree-automations';export function AutomationsSection(){return null}`,
      }),
    );
    await page.route("**/packages/ui/src/v4/V4WorkspaceChatArea.tsx*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export function V4WorkspaceChatArea(p){return window.__React.createElement('main',{'data-testid':'tree-chat','data-workspace':p.workspacePath,'data-native':p.sessionId??'','data-acp':p.acpOpenRequest?.session.id??''},'Existing conversation')}`,
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/${name}.html?locale=${locale}`,
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    const sidebar = page.getByTestId("sidebar");
    const rail = sidebar.getByTestId("workspace-sidebar-action-rail");
    const tree = sidebar.getByTestId("workspace-list");
    const project = sidebar.getByTestId("workspace-item-/synthetic/project");
    const other = sidebar.getByTestId("workspace-item-/synthetic/other");
    const native = sidebar.getByTestId("task-item-native-tree");
    const acp = sidebar.locator('[data-acp-session-id="acp-tree"]');
    await native.waitFor({ timeout: 60000 }).catch((error) => {
      throw Error(errors.join("\n") || error.message);
    });
    await acp.waitFor();
    await page.evaluate((theme) => window.__tree.theme(theme), theme);
    await page.getByTestId("RepositoryPanel").waitFor();
    assert.equal(await rail.count(), 1, "Current sidebar must retain the left action rail");
    assert.equal(await rail.getByRole("button").count(), 4);
    const railBounds = await rail.boundingBox();
    assert.equal(railBounds.width, 48);
    for (const button of await rail.getByRole("button").all()) {
      assert.ok(await button.getAttribute("aria-label"));
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= railBounds.x && bounds.x + bounds.width <= railBounds.x + 48);
    }
    const boardEntryBounds = await sidebar.getByTestId("agent-board-sidebar-open").boundingBox();
    assert.ok(boardEntryBounds.x >= railBounds.x + 48);
    const projectBounds = await project.boundingBox();
    assert.ok(projectBounds.x >= railBounds.x + 48);
    const projectName = sidebar.getByTestId("workspace-name-/synthetic/project");
    const projectItem = project.locator("xpath=ancestor::li[1]");
    const otherName = sidebar.getByTestId("workspace-name-/synthetic/other");
    const assertProjectSpacing = async () => {
      // 项目展开动画会暂时裁切任务，须等真实动画完成后再测量相邻项目的间距。
      await projectItem.locator('[data-slot="collapsible-content"]').evaluate(async (element) => {
        await Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
      });
      const header = await projectName.boundingBox();
      const firstTask = await projectItem
        .locator(".sidebar-conversation-row")
        .first()
        .boundingBox();
      const lastTask = await projectItem.locator(".sidebar-conversation-row").last().boundingBox();
      const nextHeader = await otherName.boundingBox();
      const taskGap = firstTask.y - (header.y + header.height);
      const projectGap = nextHeader.y - (lastTask.y + lastTask.height);
      assert.equal(header.height, 24, "Single-line project title uses a compact 24px hit area");
      assert.equal(taskGap, 0, `Title/task gap must be 0px, got ${taskGap}`);
      assert.ok(projectGap >= 0 && projectGap <= 2.5, `Project gap must be 2px, got ${projectGap}`);
    };
    await assertProjectSpacing();
    await projectName.hover();
    await assertProjectSpacing();
    await projectName.focus();
    await assertProjectSpacing();
    await rail.evaluate((element) => (window.__tree.rail = element));
    await other.click();
    assert.equal(await other.getAttribute("aria-expanded"), "false");
    await tree.evaluate((element) => (window.__tree.node = element));
    const enterBoard = async () => {
      await sidebar.getByTestId("agent-board-sidebar-open").click();
      await page.getByTestId("agent-board").waitFor();
      assert.equal(await rail.isVisible(), true);
      assert.equal(await rail.evaluate((element) => element === window.__tree.rail), true);
      assert.equal(
        await sidebar.getByTestId("agent-board-sidebar-open").getAttribute("aria-pressed"),
        "true",
      );
      // 原回归只断言入口高亮，漏掉了整棵树被统计导航替换；这里验证真实节点存活。
      assert.equal(
        await tree.isVisible(),
        true,
        "Agent board must retain the repository project tree",
      );
      assert.equal(await tree.evaluate((element) => element === window.__tree.node), true);
      assert.equal(await native.isVisible(), true);
      assert.equal(await acp.isVisible(), true);
      assert.equal(await other.getAttribute("aria-expanded"), "false");
      await assertProjectSpacing();
      assert.equal(await sidebar.getByTestId("sidebar-unread-filter").isVisible(), true);
      assert.equal(await sidebar.locator("[data-board-sidebar-counts]").count(), 0);
      assert.equal(
        await sidebar
          .getByText(
            /^(所有项目|常用项目|查找全部项目|All projects|Pinned projects|Browse all projects)$/,
          )
          .count(),
        0,
      );
      assert.equal(
        await sidebar.locator('.sidebar-conversation-row[aria-current="page"]').count(),
        0,
      );
    };
    await enterBoard();
    await page
      .getByTestId("agent-board")
      .getByText("Existing Native task", { exact: true })
      .waitFor()
      .catch(async (error) => {
        throw Error(
          `${error.message}\n${await page.getByTestId("agent-board").innerText()}\n${errors.join("\n")}`,
        );
      });
    await page.screenshot({ path: join(artifacts, `${width}-${locale}-${theme}.png`) });
    await project.click();
    assert.equal(await project.getAttribute("aria-expanded"), "false");
    await sidebar.getByTestId("repository-sidebar-open").click();
    await page.getByTestId("RepositoryPanel").waitFor();
    assert.equal(await project.getAttribute("aria-expanded"), "false");
    await project.click();
    await enterBoard();
    await native.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="tree-chat"]')?.getAttribute("data-native") ===
        "native-tree",
    );
    assert.deepEqual(await page.evaluate(() => window.__tree.selections.at(-1)), [
      "/synthetic/project",
      "native-tree",
    ]);
    await enterBoard();
    await acp.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="tree-chat"]')?.getAttribute("data-acp") ===
        "acp-tree",
    );
    assert.equal(
      await page.getByTestId("tree-chat").getAttribute("data-workspace"),
      "/synthetic/project",
    );
    // 展示偏好继续由原有侧栏 owner 持有，切看板不能重建或重置分组视图。
    await sidebar
      .getByRole("tab", { name: locale === "zh-CN" ? "分组" : "Group", exact: true })
      .click();
    await tree.waitFor({ state: "detached" });
    const group = sidebar.locator('[data-grouped-group-item-id="fixture-group"]');
    await group.waitFor();
    await group.locator('[data-grouped-group-header-id="fixture-group"]').click();
    assert.equal(await group.getAttribute("data-group-collapsed"), "true");
    await group.evaluate((element) => (window.__tree.group = element));
    await sidebar.getByTestId("agent-board-sidebar-open").click();
    await page.getByTestId("agent-board").waitFor();
    assert.equal(await tree.count(), 0);
    assert.equal(await sidebar.getByTestId("sidebar-unread-filter").isVisible(), true);
    assert.equal(await group.evaluate((element) => element === window.__tree.group), true);
    assert.equal(await group.getAttribute("data-group-collapsed"), "true");
    await sidebar.getByTestId("repository-sidebar-open").click();
    await page.getByTestId("RepositoryPanel").waitFor();
    assert.equal(await tree.count(), 0);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("zcode-sidebar-task-preferences")).organizeBy,
      ),
      "grouped",
    );
    assert.equal(await group.evaluate((element) => element === window.__tree.group), true);
    assert.equal(await group.getAttribute("data-group-collapsed"), "true");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(await page.evaluate(() => window.__tree.writes), []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${width}px ${locale} ${theme}: 24px title, 0px title/task gap, 2px project gap, real board/repository entry, shared tree lifetime, collapse, Native/ACP navigation and group preference`,
    );
  }
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html, moduleFile].map((path) => rm(path, { force: true })));
}
