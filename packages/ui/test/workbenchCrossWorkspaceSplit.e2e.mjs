// Real shell split/selection callbacks, group/layout owners and pane chrome; synthetic sidebar/Host.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__workbench-cross-workspace-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-cross-workspace-"));
let browser;

try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState,useRef,useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {createPortal} from 'react-dom';
    import {WorkspaceShellLayout} from '../../../ui/src/app-shell/WorkspaceShellLayout.tsx';
    import {useV4SplitPaneEntry} from '../../../ui/src/v4/splitPaneEntryContext.tsx';
    import {usePaneLayoutStore} from '../../../ui/src/v4/paneLayoutStore.ts';
    import {useWorkbenchGroupStore} from '../../../ui/src/v4/workbenchGroupStore.ts';
    import {WorkbenchConversationTabContent} from '../../../ui/src/v4/WorkbenchConversationTabContent.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    window.__React=React;window.__createPortal=createPortal;window.__TabContent=WorkbenchConversationTabContent;
    window.__SplitEntryHook=useV4SplitPaneEntry;
    const project={workspacePath:'/fixture/project'},tasks={workspacePath:'/fixture/tasks'};
    const session=(scope,id,agent)=>({...scope,id,agent,title:id,status:'idle',createdAt:0,updatedAt:0});
    const conversations={projectApi:{...project,sessionId:'project-api'},projectAcp:session(project,'project-acp','codex'),taskApi:{...tasks,sessionId:'task-api'},taskAcp:session(tasks,'task-acp','claude')};
    const panes=usePaneLayoutStore,groups=useWorkbenchGroupStore;
    groups.getState().configureClientMode('desktop-continuous');
    for(const group of Object.values(groups.getState().groups)) {
      groups.getState().confirmRestoredPaneSession(group.id,'workspace-main');
      for(const id of Object.keys(group.panes))groups.getState().confirmRestoredPaneSession(group.id,id);
    }
    const events={mounts:{},unmounts:{},nativeSelections:[],draftStarts:0};
    window.__split={project,tasks,conversations,panes,groups,events};
    const noop=()=>{};
    const services:any={zcodeAgentService:{},zcodeSessionService:{}};
    const platform:any={isWeb:true};
    const tabs=[{...project,label:'Project',workspacePurpose:'project'},{...tasks,label:'Tasks',workspacePurpose:'conversation'}];
    const gitStateFor=workspacePath=>({summary:{workspacePath,repoRoot:workspacePath,branchName:'scoped-shell:'+workspacePath,isGitAvailable:true,isRepository:true,isDirty:true,headRefType:'branch',ahead:0,behind:0},datasets:{staged:{sections:[]},unstaged:{sections:[]}}});
    function Fixture(){
      const [workspacePath,setWorkspacePath]=useState(project.workspacePath);
      const nativeSessionId=useZCodeSessionStore(state=>state.getWorkspaceState(workspacePath).activeTaskId);
      const selection={workspacePath,id:nativeSessionId};
      const [mainView,setMainView]=useState('chat');
      const sidebarContainerRef=useRef(null);
      const tabStore=useTabStoreApi();
      useEffect(()=>{
        for(const tab of tabs)tabStore.getState().ensureWorkspaceTab(tab.workspacePath,{workspacePurpose:tab.workspacePurpose});
        return tabStore.subscribe(state=>{const tab=state.tabs.find(tab=>tab.id===state.activeTabId);if(tab?.workspacePath)setWorkspacePath(tab.workspacePath)});
      },[tabStore]);
      const startDraft=(path)=>{events.draftStarts++;groups.getState().deactivateActiveGroup();panes.getState().resetToPrimaryPane();useZCodeSessionStore.getState().setActiveTaskId(path,null);setWorkspacePath(path)};
      window.__split.reset=()=>{groups.getState().resetWorkbenchGroups();panes.getState().resetToPrimaryPane();for(const tab of tabs)useZCodeSessionStore.getState().setActiveTaskId(tab.workspacePath,null);setWorkspacePath(project.workspacePath)};
      window.__split.selection=selection;
      return <div className='h-dvh'><WorkspaceShellLayout services={services} platform={platform} workspaceAbsPath={selection.workspacePath} workspaceMainView={mainView} onWorkspaceMainViewChange={setMainView}
        workspaceTabs={tabs} workspaceShellZCodeState={{draftFocusVersion:1,selectedProvider:'glm',activeTaskId:selection.id}} theme='zai-light'
        activeTaskId={selection.id} sidePaneOwnerId='fixture' projectName='Project' isWorkspaceVisible isDesktop isMacDesktop={false} isWindowsDesktop={false} isMacFullscreen={false}
        isSidebarVisible isTerminalOpen={false} isSidePaneOpen={false} isBrowserOpen={false} supportsEmbeddedBrowser={false} gitState={gitStateFor(selection.workspacePath)} activeGitSourceId='unstaged' sidePaneState={{tabs:[],activeTabId:null}}
        handleToggleSidebar={noop} handleToggleSidePane={noop} handleRefreshGit={noop} handleOpenGitReview={noop} gitWorktreeReviewSourceId='unstaged' gitWorktreeChangeSummary={{added:12,removed:3}} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop} activeTaskTitle={selection.id??''}
        commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop} onCommandCenterSearchResultHighlightRequest={noop} onCommandCenterOpenCodeViewer={noop}
        remoteWorkspaceSessions={[]} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}} browserRestoreUrls={{}} onOpenWorkspace={noop} onCreateTask={()=>startDraft(selection.workspacePath)}
        onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop}
        handleSelectTask={(path,id)=>{events.nativeSelections.push({path,id});useZCodeSessionStore.getState().setActiveTaskId(path,id);setWorkspacePath(path)}} handleStartDraftInWorkspace={startDraft}
        handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={noop} handleOpenWorkTasks={noop}
        updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={0} sidebarContainerRef={sidebarContainerRef} taskFindDialogProps={{}}
        taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}
      /></div>;
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><ServiceProvider services={services}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const [width, dark] of [
    [1440, false],
    [390, true],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    const stub = (path, body) =>
      page.route(`**/packages/ui/src/${path}*`, (route) =>
        route.fulfill({ contentType: "application/javascript", body }),
      );
    for (const [path, symbol] of [
      ["DesktopTopOverlay.tsx", "DesktopTopOverlay"],
      ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
      ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
      ["GitBranchSwitcher.tsx", "GitBranchSwitcher"],
    ])
      await stub(path, `export function ${symbol}(){return null}`);
    await stub(
      "WorkspaceHeader.tsx",
      `export function WorkspaceHeader(props){return window.__React.createElement('header',{className:'flex h-10 min-w-0 items-center'},window.__React.createElement('div',{ref:props.onConversationTabsContainerChange,className:'min-w-0 flex-1'}))}`,
    );
    await stub(
      "WorkspaceSidebar.tsx",
      `
      export function WorkspaceSidebar(props){
        const R=window.__React,entry=window.__SplitEntryHook(),{conversations}=window.__split;
        const target=(value)=>value.agent?{workspacePath:value.workspacePath,sessionId:value.id,kind:'acp',agent:value.agent}:value;
        return R.createElement('nav',{'data-testid':'fixture-sidebar',className:'flex h-full min-w-0 flex-col gap-2 overflow-auto p-2'},
          ...Object.entries(conversations).flatMap(([key,value])=>[
            R.createElement('button',{key:'open-'+key,'data-testid':'open-'+key,onClick:()=>value.agent?props.onSelectAcpSession(value):props.onSelectTask(value.workspacePath,value.sessionId)},'Open '+key),
            R.createElement('button',{key:'split-'+key,'data-testid':'split-'+key,disabled:!entry.canOpenSession(target(value)),onClick:()=>entry.openSession(target(value))},'Split '+key)]),
          R.createElement('button',{'data-testid':'new-task',onClick:props.onCreateTask},'New task'));
      }`,
    );
    await stub(
      "v4/SessionPane.tsx",
      `
      import {ConversationHeader} from './ConversationHeader.tsx';
      export function SessionPane(props){
        const R=window.__React,[draft,setDraft]=R.useState('');
        const request=props.acpOpenRequest?.session;
        const key=props.workspaceIdentity?.trim()||props.workspacePath;
        const matchingRequest=request&&(request.workspaceIdentity?.trim()||request.workspacePath)===key&&request.workspacePath===props.workspacePath;
        const acpId=props.acpBoundSessionId??(props.sessionId===null&&matchingRequest?request.id:null);
        const session=acpId??props.sessionId,agent=acpId?request?.agent:null;
        R.useEffect(()=>{const e=window.__split.events;e.mounts[props.paneId]=(e.mounts[props.paneId]??0)+1;return ()=>{e.unmounts[props.paneId]=(e.unmounts[props.paneId]??0)+1}},[]);
        R.useEffect(()=>{props.onAcpSessionChange?.(acpId?{id:acpId,agent,title:acpId}:null)},[acpId,agent,props.onAcpSessionChange]);
        return R.createElement('section',{'data-testid':'conversation-'+props.paneId,'data-session':session??'','data-kind':acpId?'acp':'native','data-workspace':props.workspacePath,'data-native-id':props.sessionId??'','data-git-branch':props.gitSummary?.branchName??'','data-git-added':props.gitWorktreeChangeSummary?.added??'','data-git-refresh':Boolean(props.onRefreshGit),'data-git-review':Boolean(props.onOpenGitReview),className:'relative flex h-full min-h-0 min-w-0 flex-col'},
          props.conversationTabContainer?window.__createPortal(R.createElement(window.__TabContent,{title:session??'新建任务',agent,model:'bigmodel-api/GLM-5.3',workspacePath:props.workspacePath}),props.conversationTabContainer):null,
          R.createElement(ConversationHeader,{title:session??'新建任务',onClosePane:props.onClosePane}),
          R.createElement('h2',{className:'truncate p-3 pt-12'},session??'新建任务'),
          R.createElement('p',{className:'truncate p-3'},session?'Synthetic conversation '+session:'Synthetic draft'),
          R.createElement('div',{className:'mt-auto flex min-w-0 gap-1'},
            R.createElement('button',{'data-testid':'split-draft-'+props.paneId,onClick:props.onSplitRight},'Split draft'),
            R.createElement('button',{'data-testid':'accepted-'+props.paneId,onClick:()=>props.onSessionCreated?.('created-'+props.paneId)},'Accepted')),
          R.createElement('textarea',{'data-testid':'draft-'+props.paneId,value:draft,onChange:event=>setDraft(event.target.value),className:'m-2 h-20 min-w-0 border border-border bg-input p-2'}));
      }`,
    );
    await stub(
      "v4/V4ConversationContext.tsx",
      "export function V4ConversationProvider({children}){return children}export function V4PaneConversationProvider({children}){return children}export function useHasV4Conversation(){return false}export function useV4Conversation(){throw new Error('No Host connection allowed in split test')}",
    );
    await stub(
      "hooks/useProviderSettingsView.ts",
      `const state={status:'ready',view:{providers:[{providerId:'bigmodel-api',effectiveConfig:{logo:{type:'builtin',key:'bigmodel'}}}]}};export function useProviderSettingsView(){return {state}};export function useProviderSettingsServiceView(){return {state}}`,
    );
    const pane = (id) => page.locator('[data-pane-id="' + id + '"]');
    const conversation = (id) => page.getByTestId("conversation-" + id);
    const assertSession = async (id, session, workspace, kind) => {
      await page.waitForFunction(
        ({ id, session, workspace, kind }) => {
          const element = document.querySelector('[data-testid="conversation-' + id + '"]');
          return (
            element?.dataset.session === session &&
            element.dataset.workspace === workspace &&
            element.dataset.kind === kind
          );
        },
        { id, session, workspace, kind },
      );
    };
    const snapshot = () =>
      page.evaluate(() => ({
        group:
          window.__split.groups.getState().groups[window.__split.groups.getState().activeGroupId],
        layout: window.__split.panes.getState(),
        events: window.__split.events,
        selection: window.__split.selection,
      }));
    const reset = async () => {
      await page.evaluate(() => window.__split.reset());
      await pane("workspace-main").waitFor();
      await assertSession("workspace-main", "", "/fixture/project", "native");
    };
    try {
      await page.goto(`${origin}/${name}.html`);
      await page
        .getByTestId("open-projectAcp")
        .waitFor()
        .catch((error) => {
          throw new Error(errors.join("\n") || error.message);
        });
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.dataset.theme = dark ? "zai-dark" : "zai-light";
      }, dark);
      for (const [primary, target] of [
        ["projectAcp", "taskApi"],
        ["projectApi", "taskAcp"],
        ["projectAcp", "taskAcp"],
        ["projectApi", "taskApi"],
        ["projectApi", "projectAcp"],
        ["projectAcp", "projectApi"],
      ]) {
        await reset();
        await page.getByTestId("open-" + primary).click();
        const primaryId = primary === "projectAcp" ? "project-acp" : "project-api";
        const targetId = {
          taskAcp: "task-acp",
          taskApi: "task-api",
          projectAcp: "project-acp",
          projectApi: "project-api",
        }[target];
        const targetWorkspace = target.startsWith("project")
          ? "/fixture/project"
          : "/fixture/tasks";
        const primaryKind = primary === "projectAcp" ? "acp" : "native",
          targetKind = target.endsWith("Acp") ? "acp" : "native";
        await assertSession("workspace-main", primaryId, "/fixture/project", primaryKind);
        await page.getByTestId("draft-workspace-main").fill("保留项目会话草稿");
        const before = await snapshot(),
          element = await conversation("workspace-main").elementHandle();
        await page.getByTestId("split-" + target).click();
        await assertSession("pane-1", targetId, targetWorkspace, targetKind);
        // 修复依据：共享面板只消费同一 workspace 的 shell Git 事实和操作，不能串到跨项目窗格。
        const shellWorkspace = (await snapshot()).selection.workspacePath;
        for (const [id, workspace] of [
          ["workspace-main", "/fixture/project"],
          ["pane-1", targetWorkspace],
        ]) {
          const sameWorkspace = workspace === shellWorkspace;
          assert.equal(
            await conversation(id).getAttribute("data-git-branch"),
            sameWorkspace ? "scoped-shell:" + shellWorkspace : "",
          );
          assert.equal(
            await conversation(id).getAttribute("data-git-added"),
            sameWorkspace ? "12" : "",
          );
          assert.equal(
            await conversation(id).getAttribute("data-git-refresh"),
            String(sameWorkspace),
          );
          assert.equal(
            await conversation(id).getAttribute("data-git-review"),
            String(sameWorkspace),
          );
        }
        await page.getByTestId("draft-pane-1").fill("保留任务会话草稿");
        await page.getByTestId("workbench-conversation-tab-pane-1").click();
        await assertSession("workspace-main", primaryId, "/fixture/project", primaryKind);
        await page.getByTestId("open-" + primary).click();
        assert.equal(await pane("workspace-main").getAttribute("data-focused"), "true");
        const state = await snapshot();
        assert.equal(state.group.primaryBinding.sessionId, primaryId);
        assert.equal(state.group.primaryBinding.kind ?? "native", primaryKind);
        assert.equal(state.group.panes["pane-1"].sessionId, targetId);
        assert.equal(
          state.events.draftStarts,
          before.events.draftStarts,
          "opening grouped ACP must not start a draft",
        );
        assert.equal(
          await page.getByTestId("draft-workspace-main").inputValue(),
          "保留项目会话草稿",
        );
        assert.equal(await page.getByTestId("draft-pane-1").inputValue(), "保留任务会话草稿");
        assert.equal(await page.evaluate((element) => element.isConnected, element), true);
        if (primaryKind === "acp")
          assert.equal(await conversation("workspace-main").getAttribute("data-native-id"), "");
        await page.getByTestId("split-" + target).click();
        assert.equal(
          await page.locator("[data-pane-id]").count(),
          2,
          "duplicate split must focus the existing pane",
        );
        await page.screenshot({ path: join(artifacts, `${width}-${primary}-${target}.png`) });
        await pane("pane-1").getByTestId("v4-split-close").click();
        await pane("pane-1").waitFor({ state: "detached" });
        await assertSession("workspace-main", primaryId, "/fixture/project", primaryKind);
        assert.equal(
          await page.getByTestId("draft-workspace-main").inputValue(),
          "保留项目会话草稿",
        );
        await element.dispose();
        console.log(
          `PASS ${width}: real shell ${primary} -> ${target}, focus/sidebar/close retain both bindings and drafts`,
        );
      }
      // Real pane draft split and accepted callback must promote the ACP primary before native navigation.
      await reset();
      await page.getByTestId("open-projectAcp").click();
      await assertSession("workspace-main", "project-acp", "/fixture/project", "acp");
      await page.getByTestId("draft-workspace-main").fill("ACP 首发提升保持");
      await page.getByTestId("split-draft-workspace-main").click();
      await page.getByTestId("accepted-pane-1").click();
      await assertSession("workspace-main", "project-acp", "/fixture/project", "acp");
      const promoted = await snapshot();
      assert.equal(promoted.group.primaryBinding.kind, "acp");
      assert.equal(promoted.group.panes["pane-1"].sessionId, "created-pane-1");
      assert.deepEqual(promoted.layout.panes, {});
      assert.equal(await page.getByTestId("draft-workspace-main").inputValue(), "ACP 首发提升保持");
      await page.getByTestId("new-task").click();
      await assertSession("workspace-main", "", "/fixture/project", "native");
      assert.equal(await page.locator("[data-pane-id]").count(), 1);
      // Ordinary ACP selection while the main pane is a draft replaces its focused secondary.
      await reset();
      await page.getByTestId("split-taskApi").click();
      await assertSession("pane-1", "task-api", "/fixture/tasks", "native");
      const beforeReplacement = await snapshot();
      await page.getByTestId("draft-pane-1").fill("保留副窗格草稿");
      await page.getByTestId("open-projectAcp").click();
      await assertSession("pane-1", "project-acp", "/fixture/project", "acp");
      await assertSession("workspace-main", "", "/fixture/project", "native");
      assert.equal((await snapshot()).events.draftStarts, beforeReplacement.events.draftStarts);
      assert.equal(await page.getByTestId("draft-pane-1").inputValue(), "保留副窗格草稿");
      // Exercise the real HTML drag/drop handler; it must use the same ACP primary identity as the shell.
      await reset();
      await page.getByTestId("open-projectAcp").click();
      await assertSession("workspace-main", "project-acp", "/fixture/project", "acp");
      await page.getByTestId("draft-workspace-main").fill("ACP 拖拽保持");
      await pane("workspace-main").evaluate((element) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData(
          "application/x-zcode-session",
          JSON.stringify({
            kind: "zcode/session",
            workspacePath: "/fixture/tasks",
            sessionId: "task-api",
          }),
        );
        const rect = element.getBoundingClientRect(),
          clientX = rect.right - 5,
          clientY = rect.top + rect.height / 2;
        element.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX,
            clientY,
          }),
        );
        element.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX,
            clientY,
          }),
        );
      });
      await assertSession("pane-1", "task-api", "/fixture/tasks", "native");
      await page.getByTestId("workbench-conversation-tab-pane-1").click();
      await assertSession("workspace-main", "project-acp", "/fixture/project", "acp");
      assert.equal((await snapshot()).group.primaryBinding.kind, "acp");
      assert.equal(await page.getByTestId("draft-workspace-main").inputValue(), "ACP 拖拽保持");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}: secondary accepted promotes ACP primary, new task resets, ACP secondary selection and drag/drop retain owner`,
      );
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `${width}-failure.png`) });
      console.error("Failure state", JSON.stringify(await snapshot()), "Page errors", errors);
      console.error(`Screenshots: ${artifacts}`);
      throw error;
    } finally {
      await page.close();
    }
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
