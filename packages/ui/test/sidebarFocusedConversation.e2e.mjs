// Real sidebar + real group/layout owners, synthetic Host metadata; never sends prompts.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__sidebar-focused-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const output = process.env.ZCODE_E2E_SCREENSHOT_DIR ?? "/tmp/zcode-sidebar-focus";
let browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState,useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceSidebar} from '../../../ui/src/WorkspaceSidebar.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {usePaneLayoutStore,V4_PRIMARY_PANE_ID} from '../../../ui/src/v4/paneLayoutStore.ts';
    import {useWorkbenchGroupStore} from '../../../ui/src/v4/workbenchGroupStore.ts';
    import {buildPrimaryWorkbenchSessionBinding,placeWorkbenchSessionInSplit,selectWorkbenchSession} from '../../../ui/src/v4/workbenchSessionPlacement.ts';
    import {persistSidebarTaskPreferences} from '../../../ui/src/lib/sidebarTaskPreferences.ts';
    import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const a='/fixture/project-a',b='/fixture/project-b',tree='/fixture/worktrees/b',tasks='/fixture/tasks';
    const tabs=[{id:'a',kind:'workspace',label:'项目 A',workspacePath:a},{id:'b',kind:'workspace',label:'项目 B',workspacePath:b},{id:'tree',kind:'workspace',label:'B 工作树',workspacePath:tree},{id:'tasks',kind:'workspace',label:'任务',workspacePurpose:'conversation',workspacePath:tasks}];
    const now=Date.now(),ids=['a','b','tree','tasks'];
    const acp=tabs.map((tab,i)=>({id:ids[i],agent:'codex',title:['主项目会话','跨项目会话','工作树会话','独立任务会话'][i],workspacePath:tab.workspacePath,status:'ready',revision:1,createdAt:now-i*1000,updatedAt:now-i*1000,entries:[{kind:'user',text:'fixture',createdAt:now-i*1000}]}));
    const api={taskId:'b',workspacePath:b,title:'同 ID 的 API 会话',provider:'glm',status:'idle',model:'bigmodel/GLM-5',createdAt:now,updatedAt:now};
    const ordinaryApi={...api,taskId:'a',workspacePath:a,title:'普通项目 API 会话'};
    const state={calls:[],readCalls:[],selections:[],theme:applyTheme};window.__focus=state;
    const noop=()=>{},subscribe=()=>()=>({dispose(){}}),acpListeners=new Set();
    const services={
      settingService:{get:async()=>({}),onDynamicChanged:subscribe},
      gitService:{getWorkspaceRepositoryInfo:async({workspacePath})=>({workspacePath,kind:workspacePath===tree?'linked-worktree':'main-tree',repoRoot:workspacePath===tree?b:workspacePath,...(workspacePath===tree?{mainWorktreePath:b}:{})})},
      zcodeTaskService:{onDynamicWorkspaceEvent:subscribe,listTasks:async scope=>[ordinaryApi,api].filter(t=>t.workspacePath===scope.workspacePath),listPinnedTaskIds:async()=>[],listPinnedTasks:async()=>[],listArchivedTasks:async()=>[],listDeletedTaskIds:async()=>[]},
      acpService:{list:async(scope)=>{state.readCalls.push(scope);return acp.filter(s=>s.workspacePath===scope.workspacePath)},onDynamicSessionChanged:scope=>callback=>{const subscription={scope,callback};acpListeners.add(subscription);return {dispose(){acpListeners.delete(subscription)}}},updateRow:async(input)=>{state.calls.push(input)}},
      windowControllerService:{onDynamicControllerFrame:subscribe,subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),unsubscribeControllerV4:async()=>{},listTaskList:async(query)=>({items:query.kind==='pinned'?[]:[ordinaryApi,api].filter(t=>query.workspaceScopes.some(s=>s.workspacePath===t.workspacePath)),total:2,hasMore:false})},
    };
    connectProviderSettingsSnapshot({getView:async()=>({revision:1,providers:[],providerTemplates:[],providerOrder:[]}),onDidChange:()=>({dispose(){}})});
    persistSidebarTaskPreferences({organizeBy:'project',sortBy:'updated'});
    function Fixture(){
      const tabStore=useTabStoreApi(),[ready,setReady]=useState(false),[primary,setPrimary]=useState(acp[0]),[mode,setMode]=useState('project');
      useEffect(()=>{tabStore.setState({tabs,activeTabId:'a',activeWorkspacePath:a,expandedWorkspacePaths:new Set(tabs.map(t=>t.workspacePath))});setReady(true)},[]);
      const binding=buildPrimaryWorkbenchSessionBinding({workspacePath:primary?.workspacePath??a},null,primary?{id:primary.id,agent:primary.agent}:null);
      const select=session=>{
        state.selections.push(session.id);
        if(!selectWorkbenchSession(binding,{workspacePath:session.workspacePath,sessionId:session.id,kind:'acp',agent:session.agent})){tabStore.getState().activateTabByPath(session.workspacePath);setPrimary(session)};
      };
      state.split=()=>placeWorkbenchSessionInSplit(binding,{workspacePath:b,sessionId:'b',kind:'acp',agent:'codex'},{mode:'context-menu',side:'right'});
      state.closeMain=()=>{const store=useWorkbenchGroupStore.getState();store.closePane(store.activeGroupId,V4_PRIMARY_PANE_ID)};
      state.groupFocus=id=>{const store=useWorkbenchGroupStore.getState();store.focusPane(store.activeGroupId,id)};
      state.draft=()=>{useWorkbenchGroupStore.getState().deactivateActiveGroup();usePaneLayoutStore.getState().resetToPrimaryPane();setPrimary(null)};
      state.temporary=()=>{useWorkbenchGroupStore.getState().deactivateActiveGroup();usePaneLayoutStore.getState().splitPaneWithBinding(V4_PRIMARY_PANE_ID,'right',{workspaceScope:{workspacePath:b},sessionId:'b',kind:'acp',agent:'codex'})};
      state.primaryDraft=()=>usePaneLayoutStore.getState().focusPane(V4_PRIMARY_PANE_ID);
      state.native=()=>usePaneLayoutStore.getState().replacePaneBinding('pane-1',{workspaceScope:{workspacePath:b},sessionId:'b'});
      state.nativeA=()=>usePaneLayoutStore.getState().replacePaneBinding('pane-1',{workspaceScope:{workspacePath:a},sessionId:'a'});
      state.pin=value=>{acp[1].pinned=value;acp[1].revision++;for(const {scope,callback} of acpListeners)if(scope.workspacePath===b)callback({kind:'updated',session:acp[1]})};
      state.readonly=()=>usePaneLayoutStore.getState().replacePaneBinding('pane-1',{workspaceScope:{workspacePath:b},sessionId:'b',kind:'acp',agent:'codex',readOnly:true});
      state.unvalidated=()=>usePaneLayoutStore.getState().replacePaneBinding('pane-1',{workspaceScope:{workspacePath:b},sessionId:'b',kind:'acp',agent:'codex',restoredUnvalidated:true});
      state.mode=next=>{setMode(next);persistSidebarTaskPreferences({organizeBy:next==='timeline'?'chronological':'project',sortBy:'updated'})};
      return ready?<main data-testid='sidebar-focus-fixture' className='h-dvh bg-sidebar text-foreground' style={{width:'min(320px,100vw)'}}>
        <WorkspaceSidebar key={mode} workspacePath={primary?.workspacePath??a} activeAcpSessionId={primary?.id??null} theme='zai-dark' isDesktop={false}
          onSelectAcpSession={select} onSelectTask={(path,id)=>{state.selections.push('native:'+id);selectWorkbenchSession(binding,{workspacePath:path,sessionId:id})}}
          onStartDraftInWorkspace={noop} onCreateTask={state.draft} onCreateConversationTask={state.draft}
          onOpenFolderFromWorkspaceMenu={noop} onOpenCommandCenter={noop} onConnectRemote={noop} onSelectRemoteProject={noop}
          onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}}/>
      </main>:null;
    }
    const broadcast={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isLinux:true,isWindows:false}}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
      });
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
      // 不相关的重型文件树/账户/同步弹窗不挂载；侧栏、项目父行、列表与状态 owner 保持真实实现。
      for (const [path, symbol] of [
        ["WorkspaceFileTree.tsx", "WorkspaceFileTree"],
        ["WorkspaceSidebarFooter.tsx", "WorkspaceSidebarFooter"],
        ["settings/RemoteSyncDialogs.tsx", "RemoteSyncDialogs"],
        ["work-tasks/WorkTasksSidebarButton.tsx", "WorkTasksSidebarButton"],
      ]) {
        await page.route(`**/packages/ui/src/${path}*`, (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `export function ${symbol}(){return null}`,
          }),
        );
      }
      await page.goto(`${process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174"}/${name}.html`);
      const fixture = page.getByTestId("sidebar-focus-fixture");
      await fixture.waitFor().catch((error) => {
        throw new Error(errors.join("\n") || error.message);
      });
      await page.evaluate((theme) => window.__focus.theme(theme), theme);
      const row = (id) => fixture.locator(`[data-acp-session-id="${id}"]`);
      const selected = async (id) => {
        await page
          .waitForFunction((id) => {
            const selected = [
              ...document.querySelectorAll('.sidebar-conversation-row[data-selected="true"]'),
            ];
            return selected.length === 1 && selected[0].getAttribute("data-acp-session-id") === id;
          }, id)
          .catch(async (error) => {
            throw new Error(
              JSON.stringify({
                id,
                rows: await fixture.locator(".sidebar-conversation-row").evaluateAll((rows) =>
                  rows.map((row) => ({
                    id: row.getAttribute("data-acp-session-id"),
                    selected: row.getAttribute("data-selected"),
                  })),
                ),
                errors,
              }) +
                "\n" +
                error.message,
            );
          });
        assert.equal(await row(id).getAttribute("aria-current"), "page");
        const style = await row(id).evaluate((el) => ({
          shadow: getComputedStyle(el).boxShadow,
          marker: getComputedStyle(el, "::before").width,
        }));
        assert.match(style.shadow, /inset/);
        assert.equal(style.marker, "4px");
      };
      await row("a")
        .waitFor()
        .catch((error) => {
          throw new Error(errors.join("\n") || error.message);
        });
      await selected("a");
      await page.evaluate(() => window.__focus.split());
      await selected("b");
      await page.evaluate(() => window.__focus.groupFocus("workspace-main"));
      await selected("a");
      await row("b").click();
      await selected("b");
      await page.evaluate(() => window.__focus.closeMain());
      await selected("b");
      await fixture.screenshot({ path: join(output, `${theme}-${width}-closed-main.png`) });
      // 普通项目未参与工作树合并，切换后仍必须显示当前行。
      await row("a").click();
      await selected("a");
      await row("tree").click();
      await selected("tree");
      await row("tasks").click();
      await selected("tasks");
      await page.evaluate(() => window.__focus.mode("timeline"));
      await selected("tasks");
      await page.evaluate(() => window.__focus.mode("project"));
      await selected("tasks");
      await page.evaluate(() => window.__focus.draft());
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.sidebar-conversation-row[data-selected="true"]').length === 0,
      );
      await page.evaluate(() => window.__focus.temporary());
      await selected("b");
      const unpinnedTop = (await row("b").boundingBox()).y;
      await page.evaluate(() => window.__focus.pin(true));
      await selected("b");
      assert.equal(await row("b").count(), 1);
      assert.ok(
        (await row("b").boundingBox()).y < unpinnedTop,
        "Pinned selection follows the row into the pinned section",
      );
      await page.evaluate(() => window.__focus.pin(false));
      await selected("b");
      await page.evaluate(() => window.__focus.native());
      await page
        .waitForFunction(() => {
          const rows = document.querySelectorAll('.sidebar-conversation-row[data-selected="true"]');
          return rows.length === 1 && !rows[0].hasAttribute("data-acp-session-id");
        })
        .catch(async (error) => {
          throw new Error(
            (await fixture.innerText()) +
              "\n" +
              JSON.stringify(
                await fixture.locator(".sidebar-conversation-row").evaluateAll((rows) =>
                  rows.map((row) => ({
                    text: row.textContent,
                    selected: row.getAttribute("data-selected"),
                  })),
                ),
              ) +
              "\n" +
              error.message,
          );
        });
      await page.evaluate(() => window.__focus.nativeA());
      const ordinaryNative = fixture
        .locator(".sidebar-conversation-row")
        .filter({ hasText: "普通项目 API 会话" });
      await page.waitForFunction(() => {
        const rows = [
          ...document.querySelectorAll('.sidebar-conversation-row[data-selected="true"]'),
        ];
        return rows.length === 1 && rows[0].textContent.includes("普通项目 API 会话");
      });
      assert.equal(await ordinaryNative.getAttribute("aria-current"), "page");
      assert.equal(await row("a").getAttribute("data-selected"), "false");
      for (const action of ["readonly", "unvalidated", "primaryDraft"]) {
        await page.evaluate((action) => window.__focus[action](), action);
        await page.waitForFunction(
          () =>
            document.querySelectorAll('.sidebar-conversation-row[data-selected="true"]').length ===
            0,
        );
      }
      assert.deepEqual(
        await page.evaluate(() => window.__focus.calls),
        [],
        "Selection must not write Host state",
      );
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.close();
      console.log(
        `PASS ${width}px ${theme}: actual sidebar, cross-project/group/sole secondary/native/ACP/draft`,
      );
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
