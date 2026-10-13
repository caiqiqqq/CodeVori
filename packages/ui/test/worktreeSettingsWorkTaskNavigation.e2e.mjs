// Synthetic Host only. Run with the desktop renderer Vite server; no Agent requests.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { routeWorkTaskConversationFixture } from "./workTaskConversationFixture.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-task-navigation-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useCallback,useEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ManagedWorktreesList} from '../../../ui/src/settings/ManagedWorktreesList.tsx';
    import {WorkTasksPanel} from '../../../ui/src/work-tasks/WorkTasksPanel.tsx';
    import {useWorktreeSettingsConversation} from '../../../ui/src/hooks/useWorktreeSettingsConversation.ts';
    import {useWorkspaceMainViewSettingsExit} from '../../../ui/src/app-shell/useWorkspaceMainViewSettingsExit.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStoreApi,useTabStore} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {workTaskNavigationStore} from '../../../ui/src/store/workTaskNavigationStore.ts';
    import '../../../ui/src/styles.css';
    window.__React=React;
    const project='/synthetic/project',tree='/synthetic/trees/abcd/project';
    const state:any={calls:[],closed:[],pending:[],defer:false,fail:false};window.__tasks=state;
    const tasks=['api','acp'].map(kind=>({id:'work-'+kind,title:'Task '+kind,prompt:'Instructions',workspacePath:project,status:'review',archived:false,stopPending:false,runSeq:1,runText:'Instructions',commandId:'cmd',sessionRequestId:'request',createdAt:1,updatedAt:1,worktree:{path:tree,projectPath:project,rootPath:'/synthetic/trees',branchName:'worktree/abcd',baseCommit:'abc'},session:{kind,id:'session-'+kind},execution:kind==='api'?{kind,modelSelection:{providerId:'api',modelId:'test'},mode:'build'}:{kind,agent:'codex',config:[]}}));
    const services:any={
      gitService:{async listManagedWorktrees(){return [{projectPath:project,worktrees:[{worktreePath:tree,branchName:'worktree/abcd'}]}]},async getWorkspaceRepositoryInfo(r:any){return {...r,kind:'main-tree',repoRoot:r.workspacePath,isGitAvailable:true}}},
      zcodeTaskService:{async listTasks(){return [{taskId:'session-api',title:'Bound API',updatedAt:2},{taskId:'ordinary',title:'Ordinary API',updatedAt:1}]},async listPinnedTasks(){return []},async listArchivedTasks(){return []}},
      acpService:{async list(){return [{id:'session-acp',agent:'codex',title:'Bound ACP',workspacePath:tree,status:'idle',entries:[{id:'user',kind:'user',text:'Instructions',createdAt:1}]}]}},
      workTaskService:{async list(r:any){state.calls.push({op:'list',...r});if(state.fail){state.fail=false;throw new Error('Synthetic read failure')}const result={tasks:r.workspacePath===project?structuredClone(tasks):[],concurrency:1};if(state.defer){state.defer=false;return new Promise(resolve=>state.pending.push(()=>resolve(result)))}return result},onDynamicChanged:()=>()=>({dispose(){}})},
    };
    // 当前完成弹窗会只读查询结果来源；补齐合成 Host 契约，避免导航回归被缺失接口打断。
    services.workTaskService.getResultSource=async(r:any)=>r.id==='work-acp'
      ? {kind:'acp',agent:'codex',modelId:'test'}
      : {kind:'api',selection:{providerId:'api',modelId:'test'}};
    const forbidden=(op:string)=>()=>{state.calls.push({op});throw new Error('Navigation issued a business write')};
    for(const op of ['create','update','start','cancel','complete','archive','merge'])services.workTaskService[op]=forbidden(op);
    for(const op of ['create','prompt','connect','refresh','setConfigOption'])services.acpService[op]=forbidden('acp-'+op);
    function Fixture(){
      const tabs=useTabStoreApi();state.tabs=tabs;state.navigation=workTaskNavigationStore;
      const tabState=useTabStore(s=>s);const visible=tabState.activeTabId!=='settings';
      const [view,setView]=useState<any>('work-tasks');const [rootPath,setRoot]=useState('/synthetic/trees');state.setRoot=setRoot;
      useEffect(()=>{state.appliedRoot=rootPath},[rootPath]);
      const exit=useCallback(()=>setView('chat'),[]);
      const {preserveNextSettingsExit}=useWorkspaceMainViewSettingsExit({isWorkspaceVisible:visible,workspaceMainView:view,onExitSettings:exit});
      const openTasks=useCallback(()=>{preserveNextSettingsExit();state.calls.push({op:'open-work-tasks'});setView('work-tasks')},[preserveNextSettingsExit]);
      const selectApi=useCallback((path:string,id:string)=>{state.calls.push({op:'select-api',path,id});setView('chat')},[]);
      const selectAcp=useCallback((session:any)=>{state.calls.push({op:'select-acp',session});setView('chat')},[]);
      useWorktreeSettingsConversation({selectApi,selectAcp,openWorkTasks:openTasks});
      state.settings=()=>tabs.setState({activeTabId:'settings'});state.show=()=>tabs.getState().addTab(project);
      useEffect(()=>{workTaskNavigationStore.setState({project:null,tasks:{}});tabs.setState({tabs:[{id:'remote',kind:'workspace',workspacePath:project,workspaceIdentity:'remote-project',remoteSessionId:'remote-host',label:'Remote',workspacePurpose:'project'}],activeTabId:'settings',activeWorkspacePath:project,activeWorkspaceIdentity:null})},[tabs]);
      return <ServiceProvider services={services}><div className='h-dvh' data-testid='navigation-view' data-view={view} data-visible={String(visible)}>
        {!visible?<ManagedWorktreesList root={rootPath}/>:view==='work-tasks'?<WorkTasksPanel workspacePath={project} workspaceTabs={tabState.tabs.filter(t=>t.kind==='workspace')} onOpenConversation={forbidden('external-conversation')}/>:<p>Ordinary history</p>}
      </div></ServiceProvider>
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{} as any}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // 首次安装后的 Vite 依赖优化需要时间；页面就绪仍按具体可见元素断言。
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    process.stderr.write(`${error.stack ?? error.message}\n`);
  });
  await routeWorkTaskConversationFixture(page);
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const history = page.getByTestId("managed-worktrees");
  const openSettings = async () => {
    await page.evaluate(() => window.__tasks.settings());
    await history.getByRole("button", { name: /^Bound API/ }).waitFor();
  };
  for (const kind of ["api", "acp", "api"]) {
    await openSettings();
    await history.getByRole("button", { name: new RegExp(`^Bound ${kind.toUpperCase()}`) }).click();
    const session = page.getByTestId("work-task-fixture-session");
    await session.waitFor();
    assert.equal(await session.getAttribute("data-kind"), kind);
    assert.equal(await session.getAttribute("data-session"), `session-${kind}`);
    assert.equal(await session.getAttribute("data-workspace"), "/synthetic/trees/abcd/project");
    assert.deepEqual(
      await page.evaluate(() => {
        const tab = window.__tasks.tabs.getState();
        const navigation = window.__tasks.navigation.getState();
        return {
          identity: tab.activeWorkspaceIdentity,
          path: tab.activeWorkspacePath,
          treeTabs: tab.tabs.filter((t) => t.workspacePath === "/synthetic/trees/abcd/project")
            .length,
          project: navigation.project,
          selected: navigation.tasks[navigation.project],
        };
      }),
      {
        identity: null,
        path: "/synthetic/project",
        treeTabs: 0,
        project: '["/synthetic/project",""]',
        selected: `work-${kind}`,
      },
    );
  }
  await openSettings();
  await page.evaluate(() => {
    window.__tasks.defer = true;
  });
  await history.getByRole("button", { name: /^Bound API/ }).click();
  await page.waitForFunction(() => window.__tasks.pending.length === 1);
  await history.getByRole("button", { name: /^Bound ACP/ }).click();
  await page.getByTestId("work-task-fixture-session").waitFor();
  await page.evaluate(() => window.__tasks.pending.shift()());
  assert.equal(
    await page.getByTestId("work-task-fixture-session").getAttribute("data-session"),
    "session-acp",
  );

  for (const leave of ["root", "unmount"]) {
    await openSettings();
    await page.evaluate(() => {
      window.__tasks.defer = true;
    });
    await history.getByRole("button", { name: /^Bound API/ }).click();
    await page.waitForFunction(() => window.__tasks.pending.length === 1);
    await page.evaluate(
      (leave) =>
        leave === "root" ? window.__tasks.setRoot("/synthetic/new-root") : window.__tasks.show(),
      leave,
    );
    // 先等目录切换/卸载真正提交，再释放旧读取；否则测试的是 React 尚未生效的旧页面。
    if (leave === "root")
      await page.waitForFunction(() => window.__tasks.appliedRoot === "/synthetic/new-root");
    else await history.waitFor({ state: "detached" });
    await page.evaluate(() => window.__tasks.pending.shift()());
    assert.equal(
      await page.evaluate(
        () => window.__tasks.navigation.getState().tasks['["/synthetic/project",""]'],
      ),
      "work-acp",
    );
  }
  await openSettings();
  await page.evaluate(() => {
    window.__tasks.fail = true;
  });
  await history.getByRole("button", { name: /^Bound API/ }).click();
  await page.waitForFunction(() => window.__tasks.fail === false);
  assert.equal(await history.count(), 1, "Failed ownership read stays in settings");
  await history.getByRole("button", { name: /^Bound API/ }).click();
  await page.getByTestId("work-task-fixture-session").waitFor();
  await openSettings();
  await history.getByRole("button", { name: /^Ordinary API/ }).click();
  await history.waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() =>
      window.__tasks.calls.filter((c) => !["list", "open-work-tasks"].includes(c.op)),
    ),
    [{ op: "select-api", path: "/synthetic/trees/abcd/project", id: "ordinary" }],
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: API/ACP settings open owning tasks; repeat navigation, missing local parent, remote path isolation, latest click, root/unmount invalidation, failed-read retry, ordinary history, zero business writes.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
