// Shared shell/panels with a synthetic Host; no user tasks, PTYs or model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__work-task-tools-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-work-task-tools-"));
let browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState,useRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceShellLayout} from '../../../ui/src/app-shell/WorkspaceShellLayout.tsx';
    import {useAppPanels} from '../../../ui/src/hooks/useAppPanels.ts';
    import {useGitRepository} from '../../../ui/src/hooks/useGitRepository.ts';
    import {useWorkTaskWorkspaceTools} from '../../../ui/src/hooks/useWorkTaskWorkspaceTools.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import icon from '../../../ui/src/assets/provider-icons/logo-zai.svg';
    import '../../../ui/src/styles.css';
    window.__React=React;
    const state:any={calls:[],target:null};window.__tools=state;
    const noop=()=>{};
    const tasks:any=['api','acp','pending','other'].map((kind,index)=>({id:kind,title:kind+' task',prompt:'Synthetic task',runText:'Synthetic task',workspacePath:kind==='other'?'/synthetic/other':'/synthetic/main',status:kind==='pending'?'todo':'running',execution:kind==='acp'?{kind:'acp',agent:'codex',config:[]}:{kind:'api',modelSelection:{providerId:'test',modelId:'model'},mode:'build'},...(kind==='pending'?{}:{session:{kind:kind==='acp'?'acp':'api',id:kind+'-session'},worktree:{rootPath:'/synthetic/trees',path:'/synthetic/trees/'+kind+'/project',projectPath:'/synthetic/main',branchName:'worktree/'+kind,baseCommit:'abcdef'}}),archived:false,stopPending:false,runSeq:1,createdAt:index,updatedAt:index,commandId:'command',sessionRequestId:'request'}));
    const changed=new Set();state.archive=(id:string)=>{tasks.find(t=>t.id===id).archived=true;for(const listener of changed)listener()};
    state.review=(id:string)=>{Object.assign(tasks.find(t=>t.id===id),{status:'review',sourceBranch:'release'});for(const listener of changed)listener()};
    const services:any={
      workTaskService:{async list(scope:any){return {tasks:structuredClone(tasks.filter(task=>task.workspacePath===scope.workspacePath&&!task.archived)),concurrency:1}},onDynamicChanged:()=>listener=>{changed.add(listener);return {dispose:()=>changed.delete(listener)}}},
      gitService:{async getLocalBranches(r:any){state.calls.push({op:'branches',...r});return {headRefType:'branch',currentBranchName:'main',branches:['main','release'].map(name=>({name,isCurrent:name==='main',upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}))}},async getWorkspaceRepositoryInfo(r:any){return {...r,isGitAvailable:true,kind:'main-tree',repoRoot:r.workspacePath}},async refresh(r:any){state.calls.push({op:'git',...r});return {summary:{...r,repoRoot:r.workspacePath,workspaceInRepoPath:'.',autoRefreshWatchPaths:[],branchName:'main',trackingBranchName:null,headRefType:'branch',ahead:0,behind:0,isDirty:false,isGitAvailable:true},unstagedChanges:[],stagedChanges:[]}}},
      zcodeAgentService:{},zcodeSessionService:{},
    };
    const platform:any={isWeb:true,async getInstalledEditors(){return [{id:'finder',name:'Finder',iconDataUrl:icon}]},async openInEditor(editor:string,path:string,options:any){state.calls.push({op:'editor',editor,path,options});return {success:true}},async openExternal(url:string){state.calls.push({op:'external',url})}};
    const tabs:any=[{workspacePath:'/synthetic/main',label:'Main',workspacePurpose:'project'},{workspacePath:'/synthetic/other',label:'Other',workspacePurpose:'project'}];
    function Fixture(){
      const [mainView,setMainView]=useState<any>('work-tasks');const [workspacePath,setWorkspacePath]=useState('/synthetic/main');
      const tools=useWorkTaskWorkspaceTools({workspacePath},mainView==='work-tasks');state.target=tools.target;state.oldClear=state.oldClear||tools.onTargetChange;state.root=setWorkspacePath;state.view=setMainView;
      const path=tools.target?.workspacePath??workspacePath;
      const panels=useAppPanels({workspaceAbsPath:path,activeTaskId:tools.target?.nativeSessionId??null,sidePaneOwnerId:tools.target?.sidePaneOwnerId??'main-draft',isDesktop:false,supportsEmbeddedBrowser:false,defaultWhiteboardNamePrefix:'Board',platform});
      const gitState=useGitRepository({workspacePath:path,activeTaskId:tools.target?.nativeSessionId??null,includeExtendedData:panels.sidePaneState?.tabs.some(tab=>tab.type==='git')});
      const sidebarContainerRef=useRef(null);
      return <div className='h-dvh'><WorkspaceShellLayout {...panels} services={services} platform={platform} workspaceAbsPath={workspacePath} workspaceMainView={mainView} onWorkspaceMainViewChange={setMainView}
        workTaskTools={{...tools,services}} workspaceTabs={tabs} workspaceShellZCodeState={{draftFocusVersion:0,selectedProvider:'glm',activeTaskId:null}} theme='zai-light'
        activeTaskId={null} sidePaneOwnerId='main-draft' projectName='Main' isWorkspaceVisible isDesktop={true} isMacDesktop={false} isWindowsDesktop={false} isMacFullscreen={false}
        isSidebarVisible={false} isSidePaneOpen={!panels.isSidePaneCollapsed} isBrowserOpen={false} supportsEmbeddedBrowser={false} gitState={gitState} activeGitSourceId='unstaged'
        handleToggleSidePane={panels.handleToggleSidePaneCollapse} handleRefreshGit={noop} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop} activeTaskTitle=''
        handleOpenGitReview={()=>panels.handleOpenGit()}
        commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop} onCommandCenterSearchResultHighlightRequest={noop} onCommandCenterOpenCodeViewer={noop}
        remoteWorkspaceSessions={[]} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}} browserRestoreUrls={{}} onOpenWorkspace={noop} onCreateTask={noop}
        onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} handleSelectTask={noop} handleStartDraftInWorkspace={noop}
        handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={noop} handleOpenWorkTasks={noop}
        updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={0} sidebarContainerRef={sidebarContainerRef} taskFindDialogProps={{}}
        taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}
      /></div>;
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ServiceProvider services={services}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const stub = async (path, body) =>
    page.route(`**/packages/ui/src/${path}*`, (route) =>
      route.fulfill({ contentType: "application/javascript", body }),
    );
  for (const [path, symbol] of [
    ["WorkspaceSidebar.tsx", "WorkspaceSidebar"],
    ["DesktopTopOverlay.tsx", "DesktopTopOverlay"],
    ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
    ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
    ["GitBranchSwitcher.tsx", "GitBranchSwitcher"],
  ])
    await stub(path, `export function ${symbol}(){return null}`);
  await stub("v4/V4WorkspaceChatArea.tsx", "export function V4WorkspaceChatArea(){return null}");
  await stub(
    "WorkspaceHeader.tsx",
    `import {WorkspaceHeaderActionSection} from '/@fs${new URL("../src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx", import.meta.url).pathname}';export function WorkspaceHeader(props){return window.__React.createElement('header',{'data-testid':'normal-chat-tools'},window.__React.createElement(WorkspaceHeaderActionSection,props))}`,
  );
  await stub(
    "v4/SessionPane.tsx",
    `export function SessionPane(props){const R=window.__React;return R.createElement('div',{'data-testid':'tool-session','data-session':props.acpBoundSessionId??props.sessionId,'data-workspace':props.workspacePath,className:'flex h-full flex-col'},R.createElement('textarea',{'aria-label':'Synthetic draft',className:'mt-auto border border-border m-4'}))}`,
  );
  await stub(
    "v4/V4ConversationContext.tsx",
    "export function V4ConversationProvider({children}){return children}export function V4PaneConversationProvider({children}){return children}export function useHasV4Conversation(){return false}export function useV4Conversation(){throw new Error('No model connection allowed in tools test')}",
  );
  await stub(
    "Terminal.tsx",
    `export function Terminal(props){const R=window.__React;R.useEffect(()=>{if(props.isVisible)window.__tools.calls.push({op:'terminal',cwd:props.cwd})},[props.cwd,props.isVisible]);return R.createElement('div',{'data-testid':'tool-terminal','data-cwd':props.cwd,'data-open-keys':JSON.stringify(props.openWorkspaceKeys)},R.createElement('button',{onClick:props.onClose},'Close synthetic terminal'))}`,
  );
  await stub(
    "SidePaneTerminalPane.tsx",
    `export function SidePaneTerminalPane(props){return window.__React.createElement('div',{'data-testid':'tool-side-terminal','data-cwd':props.cwd},props.cwd)}`,
  );
  await stub(
    "GitPane.tsx",
    `export function GitPane(props){return window.__React.createElement('div',{'data-testid':'tool-git','data-workspace':props.workspacePath,'data-git-key':props.gitState.workspaceKey},props.workspacePath)}`,
  );
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("work-tasks-panel");
  await panel
    .getByTestId("work-task-no-selection")
    .waitFor()
    .catch((error) => {
      throw new Error(errors.join("\n") || error.message);
    });
  assert.equal(
    await page.getByTestId("tool-terminal").count(),
    0,
    "closed tools must not start terminals",
  );
  const card = (id) =>
    panel
      .locator(`[data-task-id="${id}"]`)
      .getByRole("button", { name: `${id} task`, exact: true });
  const selectedHeader = () => panel.getByTestId("work-task-content").locator(":scope > header");
  const side = page.locator('[data-workspace-side-frame="true"]');
  const closeSide = async () => {
    await side.getByRole("button", { name: "收起侧边面板", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-workspace-side-frame="true"]').getAttribute("aria-hidden") ===
        "true",
    );
  };
  for (const id of ["api", "acp"]) {
    await card(id).click();
    await page.locator(`[data-testid="tool-session"][data-session="${id}-session"]`).waitFor();
    const path = `/synthetic/trees/${id}/project`;
    await page.waitForFunction((path) => window.__tools.target?.workspacePath === path, path);
    const session = await page.getByTestId("tool-session").elementHandle();
    await page
      .getByRole("textbox", { name: "Synthetic draft", exact: true })
      .fill("保留原对话草稿");
    await selectedHeader().getByTestId("terminal-toggle").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-workspace-terminal-frame="true"] > div')
          ?.getAttribute("aria-hidden") === "false",
    );
    await page.locator(`[data-testid="tool-terminal"][data-cwd="${path}"]`).waitFor();
    assert.ok(
      JSON.parse(await page.getByTestId("tool-terminal").getAttribute("data-open-keys")).includes(
        path,
      ),
    );
    await page.getByRole("button", { name: "Close synthetic terminal", exact: true }).click();
    await selectedHeader().getByTestId("side-pane-toggle").click();
    await side.locator('[data-side-pane-open-tab-item="terminal"]').click();
    await page.locator(`[data-testid="tool-side-terminal"][data-cwd="${path}"]`).waitFor();
    await closeSide();
    await selectedHeader().getByTestId("side-pane-toggle").click();
    await side.getByRole("button", { name: "新增标签", exact: true }).click();
    await page.getByRole("menuitem", { name: "审查", exact: true }).click();
    await page
      .locator(`[data-testid="tool-git"][data-workspace="${path}"][data-git-key="${path}"]`)
      .waitFor();
    await page.screenshot({ path: join(artifacts, `${id}-review-open.png`) });
    await closeSide();
    assert.equal(
      await page.getByRole("textbox", { name: "Synthetic draft", exact: true }).inputValue(),
      "保留原对话草稿",
    );
    assert.equal(
      await page.evaluate((element) => element.isConnected, session),
      true,
      "tools must not remount conversation",
    );
    await session.dispose();
    await page.screenshot({ path: join(artifacts, `${id}-tools.png`) });
  }
  for (const id of ["api", "acp"]) {
    await card(id).click();
    await page.evaluate((id) => window.__tools.review(id), id);
    const content = panel.getByTestId("work-task-content");
    const merge = side.getByTestId("work-task-merge-controls");
    assert.equal(await content.getByTestId("work-task-merge-controls").count(), 0);
    await selectedHeader().getByTestId("side-pane-toggle").click();
    await merge.getByTestId("work-task-merge-target").waitFor();
    assert.ok((await merge.getByTestId("work-task-merge-target").innerText()).includes("release"));
    const session = await page.getByTestId("tool-session").elementHandle();
    const draft = page.getByRole("textbox", { name: "Synthetic draft", exact: true });
    await draft.fill(`Review ${id} draft`);
    await merge.getByTestId("work-task-merge-target").click();
    await page.getByRole("option", { name: "main", exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await closeSide();
    await selectedHeader().getByTestId("side-pane-toggle").click();
    await merge.getByTestId("work-task-merge-target").waitFor();
    assert.ok((await merge.getByTestId("work-task-merge-target").innerText()).includes("main"));
    await side.locator('[data-side-pane-tab-id="git"]').getByRole("button").click();
    await merge.waitFor({ state: "detached" });
    // 标签关闭后显式重开审查，复用同一个草稿所有者，不依赖 tab DOM 保活。
    await closeSide();
    await selectedHeader().getByTestId("side-pane-toggle").click();
    await merge.getByTestId("work-task-merge-target").waitFor();
    assert.ok((await merge.getByTestId("work-task-merge-target").innerText()).includes("main"));
    assert.equal(await draft.inputValue(), `Review ${id} draft`);
    assert.equal(await page.evaluate((element) => element.isConnected, session), true);
    await session.dispose();
    assert.ok(
      (await page.evaluate(() => window.__tools.calls)).some(
        (call) => call.op === "branches" && call.workspacePath === "/synthetic/main",
      ),
      "merge branch reads must use the task's main project, not the viewed worktree",
    );
    await page.screenshot({ path: join(artifacts, `${id}-merge-review.png`) });
    await closeSide();
  }
  await card("pending").click();
  await page.waitForFunction(() => window.__tools.target?.workspacePath === "/synthetic/main");
  await selectedHeader().getByRole("button", { name: "在 Finder 中打开", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.__tools.calls.filter((call) => call.op === "editor"))).at(-1)
      .path,
    "/synthetic/main",
  );
  await panel.getByTestId("work-task-project").click();
  await page.getByRole("option", { name: "Other", exact: true }).click();
  await panel.getByTestId("work-task-no-selection").waitFor();
  assert.equal(await page.evaluate(() => window.__tools.target), null);
  await card("other").click();
  await page.waitForFunction(() => window.__tools.target?.taskId === "other");
  await page.evaluate(() => window.__tools.root("/synthetic/other"));
  await page.waitForFunction(() => window.__tools.target?.taskId === "other");
  await page.evaluate(() => window.__tools.oldClear(null));
  assert.equal(
    (await page.evaluate(() => window.__tools.target)).taskId,
    "other",
    "stale cleanup must not clear newer workspace target",
  );
  await page.evaluate(() => window.__tools.archive("other"));
  await panel.getByTestId("work-task-no-selection").waitFor();
  assert.equal(await page.evaluate(() => window.__tools.target), null);
  await page.evaluate(() => window.__tools.view("chat"));
  await page.getByTestId("normal-chat-tools").getByTestId("terminal-toggle").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-workspace-terminal-frame="true"] > div')
        ?.getAttribute("aria-hidden") === "false",
  );
  assert.equal(
    await page.getByTestId("tool-terminal").getAttribute("data-cwd"),
    "/synthetic/other",
  );
  assert.equal(await page.evaluate(() => window.__tools.target), null);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: shared task/normal shell tools, API/ACP review merge slots and reopen retention, terminal cwd, Git worktree scopes, pending project tools, draft/node retention, project/root changes, stale cleanup and archive. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  process.stderr.write(`${errors.join("\n")}\nScreenshots: ${artifacts}\n`);
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
