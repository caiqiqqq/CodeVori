// Synthetic Hosts only: project navigation must never create a conversation or write to Git.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  assertDisconnectedRepositoryMemory,
  assertRepositorySelectionMemory,
  assertRepositorySelectionReload,
} from "./repositorySelectionMemoryAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-project-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-repository-projects-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepositoryPanel} from '../../../ui/src/repository-panel/RepositoryPanel.tsx';
    import {useWorkspaceTaskNavigation} from '../../../ui/src/app-shell/useWorkspaceTaskNavigation.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {isWorkspaceTab} from '../../../ui/src/store/tabStore.ts';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import {repositoryNavigationStore} from '../../../ui/src/store/repositoryNavigationStore.ts';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {buildRemoteWorkspaceIdentity,buildWorkspaceSessionKey} from '../../../ui/src/lib/remoteWorkspaceHistory.ts';
    import {persistV4ComposerDraft,readV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {Button} from '../../../ui/src/components/ui/button.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pending:[],pendingInfo:[],view:'repository',delayDiscovery:false,delayInfo:true,dropPrivate:false};
    window.__projects=state;
    state.setTheme=applyTheme;
    const alpha='/synthetic/alpha/project';
    const beta='/synthetic/beta/project';
    const remote=(host:string,sessionId?:string)=>{
      const target={kind:'ssh',host:host+'.example.invalid',username:'tester'};
      return {workspacePath:alpha,workspaceIdentity:buildRemoteWorkspaceIdentity(alpha,target as any),remoteTarget:target,remoteSessionId:sessionId};
    };
    const sources:any[]=[
      {workspacePath:alpha}, {workspacePath:beta}, {workspacePath:'/synthetic/non-git'},
      {workspacePath:'/synthetic/worktrees/abcd/project'},
      {workspacePath:'/synthetic/worktrees/orphan/project'},
      remote('one','session-one'),remote('two','session-two'),remote('offline'),remote('stale','session-stale'),
      {workspacePath:'/synthetic/missing',availability:'unavailable-local-directory'},
      {workspacePath:'/synthetic/conversation',workspacePurpose:'conversation'},
      ...Array.from({length:30},(_,index)=>({workspacePath:'/synthetic/extras/project-'+index})),
    ];
    state.sources=sources;
    const item=(host:string,r:any)=>({number:1,kind:r.kind,title:host+' '+r.workspacePath+' '+r.remoteName,body:'Synthetic issue',state:'open',draft:false,author:{username:'tester',avatarUrl:null},url:'https://forge.example.invalid/issues/1',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',labels:[],commentCount:0});
    const services=(host:string)=>({gitService:{
      async getWorkspaceRepositoryInfo(r:any){
        state.calls.push({op:'repository-info',host,...r});
        const linked=r.workspacePath.includes('/synthetic/worktrees/');
        const result={workspacePath:r.workspacePath,kind:linked?'linked-worktree':'main-tree',repoRoot:r.workspacePath,isGitAvailable:true,...(linked?{mainWorktreePath:r.workspacePath.includes('/orphan/')?'/synthetic/unopened/project':alpha}: {})};
        if(linked&&state.delayInfo){state.delayInfo=false;return new Promise(resolve=>state.pendingInfo.push(()=>resolve(result)))}
        return result;
      },
      async getForgeRepository(r:any){
        state.calls.push({op:'discover',host,...r});
        const remoteName=r.remoteName||'origin';
        const remoteNames=state.dropPrivate?['origin']:['origin','private'];
        const status=r.workspacePath==='/synthetic/non-git'?'not-repository':remoteNames.includes(remoteName)?'ready':'no-remote';
        const result={status,remoteNames:status==='not-repository'?[]:remoteNames,remoteName,repository:status==='ready'?{key:host+':'+r.workspacePath+':'+remoteName,name:'team/project',url:'https://forge.example.invalid/team/project',provider:'github',accountId:host,accountUsername:'tester'}:null};
        if(state.delayDiscovery){state.delayDiscovery=false;return new Promise(resolve=>state.pending.push(()=>resolve(result)))}
        return result;
      },
      async listForgeItems(r:any){state.calls.push({op:'list',host,...r});return {items:[item(host,r)],page:r.page,pageSize:20,hasMore:false,total:1,reachableTotal:1,incomplete:false}},
      async listForgeLabels(){return []},
      async getForgeItem(r:any){state.calls.push({op:'detail',host,...r});return {...item(host,r),change:null}},
      async listForgeComments(){return {items:[],page:1,pageSize:30,hasMore:false,total:0}},
    },
    clientConfigService:{async getSnapshot(){throw new Error('Files-only draft must not read plugins')}},
    modelSelectionService:{async getView(){return {revision:1,providers:[],preferredSelection:null}},onDidChange(){return {dispose(){}}}},
    acpService:{async listAvailableAgents(){state.calls.push({op:'agents',host});return [{agent:'codex',enabled:true,ready:true}]},async listAgentConfigs(){return []},onDynamicAgentConfigsChanged:()=>()=>({dispose(){}})},
    workTaskService:{async create(){throw new Error('Navigation must not save a task')}},
    });
    const base:any=services('local');
    const registry=useRemoteWorkspaceSessionStore.getState();
    state.disconnect=()=>registry.unregisterSession('session-two');
    registry.registerBaseServices(base);
    registry.registerSession({sessionId:'session-one',services:services('remote-one') as any});
    registry.registerSession({sessionId:'session-two',services:services('remote-two') as any});
    const buckets=Object.fromEntries(sources.map((source,index)=>{
      const key=buildWorkspaceSessionKey(source);
      const scopeId=index===1?'draft-beta':'saved-task-'+index;
      persistV4ComposerDraft(source.workspacePath,source.workspaceIdentity,scopeId,{text:'Unsent '+key,mode:'build'});
      return [key,{...useZCodeSessionStore.getState().getWorkspaceState(source.workspacePath,source.workspaceIdentity),activeTaskId:index===1?null:scopeId,draftSessionId:index===1?scopeId:null,draftFocusVersion:3}];
    }));
    useZCodeSessionStore.setState({workspaces:buckets});
    state.setHistory=(history:any)=>useZCodeSessionStore.setState({taskNavHistory:history});
    state.snapshot=()=>({
      workspaces:useZCodeSessionStore.getState().workspaces,
      drafts:sources.map((source,index)=>readV4ComposerDraft(source.workspacePath,source.workspaceIdentity,index===1?'draft-beta':'saved-task-'+index)),
      history:useZCodeSessionStore.getState().taskNavHistory,
    });
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    function Fixture(){
      const [visible,setVisible]=useState(true);
      const [revision,setRevision]=useState(0);
      const tabs=useTabStore(s=>s.tabs);
      const path=useTabStore(s=>s.activeWorkspacePath)??alpha;
      const identity=useTabStore(s=>s.activeWorkspaceIdentity)??undefined;
      const api=useTabStoreApi();
      const active=tabs.find(tab=>isWorkspaceTab(tab)&&buildWorkspaceSessionKey(tab)===buildWorkspaceSessionKey({workspacePath:path,workspaceIdentity:identity}));
      const nav=useWorkspaceTaskNavigation({intl:{formatMessage:({id}:any)=>id},workspaceAbsPath:path,workspaceIdentity:identity,activateTabByPath:api.getState().activateTabByPath,onNavigateToRepository:()=>{state.view='repository'}});
      state.tabs=api;state.select=nav.handleOpenRepository;
      state.preferences=repositoryNavigationStore;
      state.remount=()=>setRevision(value=>value+1);
      state.leave=()=>{api.getState().activateTabByPath(alpha);setVisible(false)};
      state.reenter=()=>{nav.handleOpenRepository();setVisible(true)};
      useEffect(()=>{api.getState().restoreTabs(sources,0);useZCodeSessionStore.getState().taskNavPushRepository(alpha)},[api]);
      return <div className='flex h-dvh min-w-0 flex-col bg-background text-foreground'>
        <nav className='flex shrink-0 gap-2 px-4 py-1'><Button aria-label='后退' disabled={!nav.canTaskNavBack} onClick={nav.handleTaskNavBack}>后退</Button><Button aria-label='前进' disabled={!nav.canTaskNavForward} onClick={nav.handleTaskNavForward}>前进</Button></nav>
        <div className='min-h-0 flex-1'>{visible?<RepositoryPanel key={revision} workspacePath={path} workspaceIdentity={identity} remoteSessionId={active?.remoteSessionId} workspaceTabs={tabs.filter(isWorkspaceTab)} onSelectProject={nav.handleOpenRepository} theme='zai-light'/>:<div data-testid='conversation-view'>会话</div>}</div>
      </div>
    }
    createRoot(document.getElementById('root')!).render(<ServiceProvider services={base}><PlatformProvider platform={{openExternal(){}} as any}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></PlatformProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("repository-panel");
  const row = () => panel.getByTestId("repository-item-row").first();
  const picker = () => page.getByTestId("repository-project-picker");
  const trigger = () => panel.getByRole("combobox", { name: "选择项目", exact: true });
  const search = () => picker().getByRole("combobox", { name: "搜索项目", exact: true });
  const option = (key) =>
    picker().locator(`[data-testid="repository-project-option"][data-workspace-key="${key}"]`);
  const choose = async (key, query = key) => {
    await trigger().click();
    await search().fill(query);
    await option(key).click();
    await picker().waitFor({ state: "detached" });
  };
  const waitRow = (text) =>
    page.waitForFunction(
      (text) =>
        document.querySelector('[data-testid="repository-item-row"]')?.textContent?.includes(text),
      text,
    );
  const snapshot = () => page.evaluate(() => window.__projects.snapshot());
  const settleVisuals = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  await waitRow("local /synthetic/alpha/project origin");
  const initial = await snapshot();
  await trigger().click();
  await page.waitForFunction(() => window.__projects.pendingInfo.length === 1);
  await picker().getByRole("status").waitFor();
  assert.equal(await option("/synthetic/worktrees/abcd/project").count(), 0);
  await page.evaluate(() => window.__projects.pendingInfo.shift()());
  await option("/synthetic/beta/project").waitFor();
  assert.equal(await option("/synthetic/worktrees/abcd/project").count(), 0);
  assert.equal(await option("/synthetic/worktrees/orphan/project").count(), 0);
  const relationCalls = await page.evaluate(
    () => window.__projects.calls.filter((call) => call.op === "repository-info").length,
  );
  assert.ok((await picker().getByRole("option").count()) > 30);
  assert.equal(await option("/synthetic/conversation").count(), 0);
  assert.equal(await option("/synthetic/missing").getAttribute("aria-disabled"), "true");
  const remoteKeys = await page.evaluate(() =>
    window.__projects.sources
      .filter((source) => source.workspaceIdentity)
      .map((source) => source.workspaceIdentity),
  );
  assert.equal(await option(remoteKeys[2]).getAttribute("aria-disabled"), "true");
  assert.equal(await option(remoteKeys[3]).getAttribute("aria-disabled"), "true");
  const list = picker().locator('[data-slot="command-list"]');
  assert.ok(await list.evaluate((node) => node.scrollHeight > node.clientHeight));
  await list.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="repository-project-picker"] [data-slot="command-list"]')
        ?.scrollTop > 0,
  );
  await search().fill("no-matching-project");
  await picker().getByText("没有匹配的项目", { exact: true }).waitFor();
  await search().fill("beta");
  await option("/synthetic/beta/project").waitFor();
  await search().press("ArrowDown");
  await search().press("ArrowUp");
  assert.equal(await option("/synthetic/beta/project").getAttribute("data-selected"), "true");
  await search().press("Enter");
  await waitRow("local /synthetic/beta/project origin");
  assert.equal((await snapshot()).history.entries.length, 2);
  await choose("/synthetic/beta/project", "beta");
  assert.equal((await snapshot()).history.entries.length, 2);
  assert.equal(await page.evaluate(() => window.__projects.view), "repository");
  await panel.getByRole("combobox", { name: "远端仓库", exact: true }).click();
  await page.getByRole("option", { name: "private", exact: true }).click();
  await waitRow("local /synthetic/beta/project private");
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await waitRow("local /synthetic/alpha/project origin");
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await waitRow("local /synthetic/beta/project private");
  assert.equal((await snapshot()).history.entries.length, 2);

  await choose(remoteKeys[0], "one.example.invalid");
  await waitRow("remote-one /synthetic/alpha/project origin");
  await row().click();
  const detail = page.getByTestId("repository-item-detail");
  await detail.getByText("Synthetic issue", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "交给智能体处理", exact: true }).click();
  const editor = page.getByTestId("work-task-editor");
  await editor.waitFor();
  const handoff = await page.evaluate(() =>
    window.__projects.calls.filter((c) => c.op === "detail").at(-1),
  );
  assert.equal(handoff.host, "remote-one");
  assert.equal(handoff.workspacePath, "/synthetic/alpha/project");
  assert.equal(handoff.workspaceIdentity, remoteKeys[0]);
  await editor.getByTestId("work-task-model").click();
  await page.getByTestId("chat-model-select-item-acp:codex").click();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await panel.getByRole("combobox", { name: "远端仓库", exact: true }).click();
  await page.getByRole("option", { name: "private", exact: true }).click();
  await waitRow("remote-one /synthetic/alpha/project private");
  await choose(remoteKeys[1], "two.example.invalid");
  await waitRow("remote-two /synthetic/alpha/project origin");
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await waitRow("remote-one /synthetic/alpha/project private");
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await waitRow("remote-two /synthetic/alpha/project origin");

  const localDiscoveries = await page.evaluate(
    () =>
      window.__projects.calls.filter((call) => call.op === "discover" && call.host === "local")
        .length,
  );
  await page.evaluate(() => window.__projects.disconnect());
  await panel.getByRole("alert").waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.__projects.calls.filter((call) => call.op === "discover" && call.host === "local")
          .length,
    ),
    localDiscoveries,
  );
  await choose(remoteKeys[0], "one.example.invalid");
  await waitRow("remote-one /synthetic/alpha/project private");
  await assertDisconnectedRepositoryMemory({ page, remoteKeys, waitRow });

  await page.evaluate(() => {
    window.__projects.delayDiscovery = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.__projects.pending.length === 1);
  await choose("/synthetic/beta/project", "beta");
  await waitRow("local /synthetic/beta/project private");
  await page.evaluate(() => window.__projects.pending.shift()());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.match(await row().innerText(), /local \/synthetic\/beta\/project private/);

  await choose("/synthetic/non-git", "non-git");
  await panel.getByText("当前项目不是 Git 仓库。", { exact: true }).waitFor();
  await page.evaluate(() =>
    window.__projects.select({ workspacePath: "/synthetic/worktrees/abcd/project" }),
  );
  await waitRow("local /synthetic/worktrees/abcd/project origin");
  await trigger().click();
  assert.equal(await option("/synthetic/alpha/project").getAttribute("data-checked"), "true");
  assert.equal(await option("/synthetic/worktrees/abcd/project").count(), 0);
  assert.equal(await option("/synthetic/worktrees/orphan/project").count(), 0);
  assert.equal(
    await page.evaluate(() => window.__projects.tabs.getState().activeWorkspacePath),
    "/synthetic/worktrees/abcd/project",
  );
  assert.equal(
    await page.evaluate(
      () => window.__projects.calls.filter((call) => call.op === "repository-info").length,
    ),
    relationCalls,
  );
  await search().press("Escape");
  await picker().waitFor({ state: "detached" });
  const preserved = await snapshot();
  assert.deepEqual(preserved.workspaces, initial.workspaces);
  assert.deepEqual(preserved.drafts, initial.drafts);
  const navBeforeMissing = preserved.history;
  await page.evaluate(() => {
    window.__projects.select({ workspacePath: "/synthetic/closed" });
    const alpha = window.__projects.tabs
      .getState()
      .tabs.find(
        (tab) => tab.workspacePath === "/synthetic/alpha/project" && !tab.workspaceIdentity,
      );
    window.__projects.tabs.getState().closeTab(alpha.id);
    window.__projects.select({ workspacePath: "/synthetic/alpha/project" });
  });
  assert.deepEqual((await snapshot()).history, navBeforeMissing);
  assert.match(await row().innerText(), /local \/synthetic\/worktrees/);
  assert.equal(
    await page.evaluate(
      () =>
        window.__projects.calls.filter(
          (call) => !["list", "discover", "detail", "agents", "repository-info"].includes(call.op),
        ).length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__projects.calls.filter((call) => call.op === "agent").length),
    0,
  );

  await page.evaluate(() =>
    window.__projects.setHistory({
      entries: [
        { kind: "repository", workspacePath: "/synthetic/beta/project" },
        { kind: "repository", workspacePath: "/synthetic/alpha/project" },
        { kind: "repository", workspacePath: "/synthetic/worktrees/abcd/project" },
      ],
      cursor: 2,
    }),
  );
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await waitRow("local /synthetic/beta/project private");
  assert.equal((await snapshot()).history.cursor, 0);
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await waitRow("local /synthetic/worktrees/abcd/project origin");
  assert.equal((await snapshot()).history.cursor, 2);
  assert.equal((await snapshot()).history.entries.length, 3);

  for (const [theme, width] of [
    ["light", 1120],
    ["dark", 1120],
    ["light", 390],
    ["dark", 390],
    ["light", 320],
    ["dark", 320],
  ]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate((theme) => {
      window.__projects.setTheme(theme);
    }, theme);
    await trigger().click();
    await search().fill("project");
    await settleVisuals();
    assert.equal(
      await trigger()
        .locator("span")
        .first()
        .evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await page.screenshot({ path: join(artifacts, `projects-${theme}-${width}.png`) });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const bounds = await picker().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await picker().evaluate((node) => node.scrollWidth > node.clientWidth), false);
    await search().press("Escape");
    await picker().waitFor({ state: "detached" });
  }
  assert.deepEqual(errors, []);
  await choose("/synthetic/beta/project", "beta");
  await waitRow("local /synthetic/beta/project private");
  await assertRepositorySelectionMemory({ page, panel, waitRow });
  await assertRepositorySelectionReload({ page, panel, waitRow, choose });
  process.stdout.write(
    `PASS: repository project search, scroll, keyboard, empty states, exact local/remote/worktree navigation, history, stale replies, task/draft preservation and responsive themes. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
