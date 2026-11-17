// Real sidebar, task navigation and task pane; synthetic Host, no Agent execution.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__unified-conversations-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const output = process.env.ZCODE_E2E_SCREENSHOT_DIR ?? "/tmp/zcode-unified-conversations";
let browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceSidebar} from '../../../ui/src/WorkspaceSidebar.tsx';
import {WorkTasksPanel} from '../../../ui/src/work-tasks/WorkTasksPanel.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {useWorktreeSettingsConversation} from '../../../ui/src/hooks/useWorktreeSettingsConversation.ts';
import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {persistSidebarTaskPreferences} from '../../../ui/src/lib/sidebarTaskPreferences.ts';
import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import '../../../ui/src/styles.css';
window.__React=React;
const p='/fixture/project',tree='/fixture/worktree',q='/fixture/other';
const tabs=[{id:'q',kind:'workspace',label:'Other',workspacePath:q},{id:'p',kind:'workspace',label:'Project',workspacePath:p},{id:'tree',kind:'workspace',label:'Tree',workspacePath:tree}];
const now=Date.now(),execution={kind:'api',modelSelection:{providerId:'api',modelId:'TestModel'},mode:'build'};
const task=(id,extra={})=>({workspacePath:p,id,title:id,prompt:'Saved prompt '+id,execution,status:'todo',archived:false,runSeq:0,runText:'Saved prompt '+id,commandId:id,sessionRequestId:crypto.randomUUID(),stopPending:false,createdAt:now-200,updatedAt:now,...extra});
const tasks=[task('Pending'),task('API task',{useWorktree:false,directBranch:'main',session:{kind:'api',id:'bound-api'},status:'review'}),task('ACP task',{useWorktree:false,directBranch:'main',execution:{kind:'acp',agent:'codex',config:[]},session:{kind:'acp',id:'bound-acp'},status:'review'}),task('Archived',{useWorktree:false,directBranch:'main',session:{kind:'api',id:'archived-api'},archived:true}),task('Other task',{workspacePath:q}),task('Canceled',{status:'canceled'}),task('Completed',{status:'done'})];
const api=(id,path=p)=>({taskId:id,workspacePath:path,title:id,provider:'api',model:'api/TestModel',status:'idle',createdAt:now-1000,updatedAt:now-1000});
const native=[api('Ordinary API'),api('bound-api'),api('archived-api'),api('bound-api',q)];
if(new URLSearchParams(location.search).has('pagination'))for(let i=0;i<25;i++){const id='page-bound-'+i;native.push({...api(id),updatedAt:now+i+1});tasks.push(task('Archived page '+i,{archived:true,useWorktree:false,directBranch:'main',session:{kind:'api',id}}))}
const acp=[{id:'ordinary-acp',workspacePath:p,title:'Ordinary ACP',agent:'codex',status:'ready',revision:1,createdAt:now-500,updatedAt:now-500},{id:'bound-acp',workspacePath:p,title:'Duplicate ACP',agent:'codex',status:'ready',revision:1,createdAt:now,updatedAt:now}].map(session=>({...session,entries:[{id:session.id,kind:'user',text:session.title,createdAt:session.createdAt}]}));
const listeners=new Set(),noop=()=>{},subscribe=()=>()=>({dispose(){}});
const state={tasks,calls:[],native,acp,theme:applyTheme,notify:()=>{for(const fn of listeners)fn()},setMode:null};window.__unified=state;
const group={id:'fixture-group',title:'Saved group',color:'gray',createdAt:now,updatedAt:now};
const structure={groups:[group],members:['bound-api','Ordinary API'].map((taskId,index)=>({groupId:group.id,workspaceKey:p,workspacePath:p,taskId,sortOrder:index*1000,addedAt:now})),topLevelOrders:[{type:'group',groupId:group.id,sortOrder:0}]};
const readList=r=>{const rows=r.kind==='pinned'?[]:native.filter(t=>r.workspaceScopes.some(s=>s.workspacePath===t.workspacePath)).sort((a,b)=>b.updatedAt-a.updatedAt);const items=r.limit?rows.slice(0,r.limit):rows;return {items,total:rows.length,hasMore:items.length<rows.length}};
const modelView={revision:1,preferredSelection:{providerId:'api',modelId:'TestModel'},providers:[{providerId:'api',providerName:'API',config:{api:{type:'openai-chat-completions'}},models:[{modelId:'TestModel',config:{optionSpecs:{}}}]}]};
const services={
 workTaskService:{list:async r=>({tasks:tasks.filter(t=>t.workspacePath===r.workspacePath&&(r.includeArchived||!t.archived)),concurrency:2}),onDynamicChanged:()=>fn=>{listeners.add(fn);return {dispose:()=>listeners.delete(fn)}},create:async r=>{state.calls.push({op:'create',...r});const next=task('Created exact ID',{...r,id:'created-exact-id'});tasks.push(next);state.notify();return next},start:async r=>state.calls.push({op:'start',...r}),setConcurrency:async()=>{}},
 settingService:{get:async()=>({}),onDynamicChanged:subscribe},
 modelSelectionService:{getView:async()=>modelView,onDidChange:()=>({dispose(){}})},
 gitService:{getWorkspaceRepositoryInfo:async({workspacePath})=>({workspacePath,kind:workspacePath===tree?'linked-worktree':'main-tree',repoRoot:workspacePath===tree?p:workspacePath,...(workspacePath===tree?{mainWorktreePath:p}:{})}),getLocalBranches:async()=>({headRefType:'branch',currentBranchName:'main',branches:[{name:'main',isCurrent:true,upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}]})},
 zcodeTaskService:{onDynamicWorkspaceEvent:subscribe,listTasks:async r=>native.filter(t=>t.workspacePath===r.workspacePath),listPinnedTaskIds:async()=>[],listPinnedTasks:async()=>[],listArchivedTasks:async()=>[],listDeletedTaskIds:async()=>[],listGroupedTaskViewStructure:async()=>structure,applyGroupedTaskViewOrder:async r=>state.calls.push({op:'group-order',...r})},
 fileService:{searchWorkspaceFiles:async()=>[]},
 clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:[]})},
 acpService:{listSummaries:async r=>acp.filter(s=>s.workspacePath===r.workspacePath),onDynamicSessionSummaryChanged:subscribe,updateRow:async r=>state.calls.push({op:'acp-update',...r}),listAvailableAgents:async()=>[],listAgentConfigs:async()=>[],onDynamicAgentConfigsChanged:subscribe},
 windowControllerService:{onDynamicControllerFrame:subscribe,subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),unsubscribeControllerV4:async()=>{},listTaskList:async r=>readList(r)},
};
connectProviderSettingsSnapshot({getView:async()=>({revision:1,providers:[],providerTemplates:[],providerOrder:[]}),onDidChange:()=>({dispose(){}})});
persistSidebarTaskPreferences({organizeBy:'project',sortBy:'updated'});
function Fixture(){
 const tabStore=useTabStoreApi(),[ready,setReady]=useState(false),[active,setActive]=useState(false),[mode,setMode]=useState('project'),[workspacePath,setWorkspacePath]=useState(p);
 state.setWorkspacePath=setWorkspacePath;
 state.setLocale=useZCodeIntl().setLocale;
 useEffect(()=>{tabStore.setState({tabs,activeTabId:'p',activeWorkspacePath:p,expandedWorkspacePaths:new Set([p,q])});setReady(true)},[]);
 const ordinary=()=>setActive(false);state.setMode=next=>{setMode(next);persistSidebarTaskPreferences({organizeBy:next==='timeline'?'chronological':next==='grouped'?'grouped':'project',sortBy:'updated'})};
 const selectNative=(path,id)=>{state.lastNativeSelection={path,id};ordinary()};
 useWorktreeSettingsConversation({selectApi:ordinary,selectAcp:ordinary,openWorkTasks:()=>setActive(true)});
 return ready?<div data-testid='unified-fixture' data-active={active} className='flex h-dvh min-w-0 bg-background text-foreground'>
 <style>{'@media(max-width:767px){[data-active=true]>.unified-sidebar{display:none}[data-active=false]>.unified-main{display:none}}'}</style>
 <aside className='unified-sidebar w-80 max-w-full shrink-0 bg-sidebar'><WorkspaceSidebar key={mode} workspacePath={workspacePath} workTasksActive={active} theme='zai-light' isDesktop={false}
 onSelectTask={selectNative} onSelectAcpSession={ordinary} onStartDraftInWorkspace={ordinary} onCreateTask={ordinary} onCreateConversationTask={ordinary} onOpenFolderFromWorkspaceMenu={noop} onOpenCommandCenter={noop} onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}}/></aside>
 <main className='unified-main min-w-0 flex-1'>{active?<WorkTasksPanel conversationOnly workspacePath={p} workspaceTabs={tabs} onOpenConversation={noop} onCloseConversation={ordinary}/>:<p>Ordinary conversation</p>}</main></div>:null;
}
const broadcast={send(){},onMessage(){return {dispose(){}}}};
createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isLinux:true,isWindows:false}}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320])
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
      for (const [path, symbol] of [
        ["WorkspaceFileTree.tsx", "WorkspaceFileTree"],
        ["WorkspaceSidebarFooter.tsx", "WorkspaceSidebarFooter"],
        ["settings/RemoteSyncDialogs.tsx", "RemoteSyncDialogs"],
      ])
        await page.route(`**/packages/ui/src/${path}*`, (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `export function ${symbol}(){return null}`,
          }),
        );
      // Only the provider runtime is replaced; navigation, binding resolution and task pane are real.
      await page.route("**/packages/ui/src/work-tasks/WorkTaskSessionView.tsx*", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `export function WorkTaskSessionView({binding}){return window.__React.createElement('div',{'data-testid':'bound-session','data-kind':binding.kind,'data-session':binding.sessionId,'data-path':binding.workspacePath},binding.sessionId)}`,
        }),
      );
      await page.goto(`${process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5188"}/${name}.html`);
      await page
        .getByTestId("unified-fixture")
        .waitFor()
        .catch((error) => {
          throw new Error(errors.join("\n") || error.message);
        });
      await page.evaluate((theme) => window.__unified.theme(theme), theme);
      const row = (id) => page.locator(`[data-work-task-id="${id}"]`);
      await row("Pending").waitFor();
      await page.getByText("Ordinary ACP", { exact: true }).waitFor();
      assert.equal(await row("Archived").count(), 0);
      assert.equal(await page.locator('[data-acp-session-id="bound-acp"]').count(), 0);
      assert.equal(await page.getByText("archived-api", { exact: true }).count(), 0);
      assert.equal(
        await page.getByText("bound-api", { exact: true }).count(),
        1,
        "same ID in another project stays visible",
      );
      await row("Pending").click();
      await page.getByTestId("work-task-conversation-main").waitFor();
      await page.getByText("Saved prompt Pending", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("work-task-board-scroll").count(), 0);
      assert.equal(
        await page.locator('.sidebar-conversation-row[data-selected="true"]').count(),
        1,
      );
      assert.deepEqual(await page.evaluate(() => window.__unified.calls), []);
      await page.screenshot({ path: join(output, `pending-${width}-${theme}.png`) });
      const close = async () =>
        page.getByRole("button", { name: "关闭任务查看", exact: true }).click();
      await close();
      await row("API task").click();
      const boundSession = page.getByTestId("bound-session");
      await boundSession.waitFor().catch((error) => {
        throw new Error(errors.join("\n") || error.message);
      });
      assert.equal(await boundSession.getAttribute("data-kind"), "api");
      assert.equal(await boundSession.getAttribute("data-session"), "bound-api");
      assert.equal(await boundSession.getAttribute("data-path"), "/fixture/project");
      await close();
      await row("ACP task").click();
      await boundSession.waitFor();
      assert.equal(await boundSession.getAttribute("data-kind"), "acp");
      assert.equal(await boundSession.getAttribute("data-session"), "bound-acp");
      await close();
      await row("Canceled").click();
      await page
        .getByTestId("v4-row-1")
        .getByText("Saved prompt Canceled", { exact: true })
        .waitFor();
      await close();
      await row("Completed").click();
      await page
        .getByTestId("work-task-content")
        .getByText("Saved prompt Completed", { exact: true })
        .waitFor();
      await close();
      await page.evaluate(() => window.__unified.setMode("timeline"));
      await row("Pending").waitFor();
      await page.getByText("Ordinary ACP", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-acp-session-id="bound-acp"]').count(), 0);
      await page.evaluate(
        () => (window.__unified.tasks.find((t) => t.id === "Pending").archived = true),
      );
      await page.evaluate(() => window.__unified.notify());
      await row("Pending").waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => window.__unified.calls), []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `sidebar-${width}-${theme}.png`) });

      assert.equal(await page.getByTestId("work-task-sidebar-create").count(), 0);
      assert.equal(await page.getByRole("button", { name: "新建待办", exact: true }).count(), 0);
      const nativeRow = page.getByTestId("task-item-Ordinary API");
      assert.equal(
        await nativeRow.locator('[data-conversation-task-status="completed"]').count(),
        1,
      );
      assert.equal(
        await page
          .locator(
            '[data-acp-session-id="ordinary-acp"] [data-conversation-task-status="completed"]',
          )
          .count(),
        1,
      );
      assert.equal(
        await row("Completed").locator('[data-conversation-task-status="completed"]').count(),
        1,
      );
      assert.equal(
        await row("Canceled").locator('[data-conversation-task-status="error"]').count(),
        1,
      );
      await page.evaluate(() => window.__unified.setMode("grouped"));
      await row("API task").waitFor();
      await page.getByText("Saved group", { exact: true }).waitFor();
      const ordinary = page.getByText("Ordinary API", { exact: true });
      await ordinary.waitFor();
      assert.equal(await page.getByText("bound-api", { exact: true }).count(), 1);
      const ordinaryRow = page.locator("[data-grouped-task-key]").filter({ has: ordinary });
      await ordinaryRow.hover();
      await ordinaryRow.getByRole("button", { name: "移动到顶部", exact: true }).click();
      await page.waitForFunction(() =>
        window.__unified.calls.some((call) => call.op === "group-order"),
      );
      const order = await page.evaluate(() =>
        window.__unified.calls.find((call) => call.op === "group-order"),
      );
      assert.deepEqual(
        order.groups[0].taskRefs.map((ref) => ref.taskId),
        ["Ordinary API", "bound-api"],
        "saving visible group operations must preserve the hidden bound member",
      );
      await page.evaluate(() => window.__unified.setLocale("en-US"));
      assert.equal(await page.getByRole("button", { name: "New to-do", exact: true }).count(), 0);
      await page.getByTestId("task-new-button").waitFor();
      assert.equal(
        await page.getByTestId("task-new-button").getAttribute("aria-label"),
        "New task",
      );
      await row("Canceled").click();
      await page.getByRole("button", { name: "Close task view", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `english-${width}-${theme}.png`) });
      await page.getByRole("button", { name: "Close task view", exact: true }).click();
      if (width === 1280 && theme === "zai-light") {
        await page.goto(
          `${process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5188"}/${name}.html?pagination=1`,
        );
        await row("Pending").waitFor();
        await page.evaluate(() => window.__unified.setMode("timeline"));
        await page.getByText("显示更多", { exact: true }).click();
        await page.getByText("Ordinary API", { exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.__unified.lastNativeSelection), {
          path: "/fixture/project",
          id: "Ordinary API",
        });
        assert.equal(await page.getByText("page-bound-0", { exact: true }).count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__unified.calls), []);
        console.log(
          "PASS pagination: hidden first page retains load-more and later row navigation",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `PASS ${width}px ${theme}: mixed rows, exact binding, direct pane, lifecycle, archive, unified task status, group persistence and English`,
      );
    }
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
