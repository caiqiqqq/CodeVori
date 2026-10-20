// Exercise real pane chrome, layout, focus and group owners with a synthetic SessionPane boundary.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__workbench-pane-closing-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-pane-closing-"));
let browser;

try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {V4WorkspaceChatArea} from '../../../ui/src/v4/V4WorkspaceChatArea.tsx';
    import {usePaneLayoutStore} from '../../../ui/src/v4/paneLayoutStore.ts';
    import {useWorkbenchGroupStore} from '../../../ui/src/v4/workbenchGroupStore.ts';
    import {selectWorkbenchSession,placeWorkbenchSessionInSplit} from '../../../ui/src/v4/workbenchSessionPlacement.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {WorkbenchConversationTabContent} from '../../../ui/src/v4/WorkbenchConversationTabContent.tsx';
    import {createPortal} from 'react-dom';
    import '../../../ui/src/styles.css';
    window.__React=React;
    window.__createPortal=createPortal;
    window.__TabContent=WorkbenchConversationTabContent;
    const scope={workspacePath:'/fixture/project',workspaceIdentity:'remote:fixture',remoteSessionId:'attachment:fixture'};
    const native={workspaceScope:scope,sessionId:'shared-id'};
    const acp={workspaceScope:scope,sessionId:'shared-id',kind:'acp',agent:'codex'};
    const claude={workspaceScope:scope,sessionId:'claude-id',kind:'acp',agent:'claude'};
    const locale=new URLSearchParams(location.search).get('locale')??'zh-CN';
    const events={mounts:{},unmounts:{},nativeSelections:[],nativeDeletes:0};
    const panes=usePaneLayoutStore,groups=useWorkbenchGroupStore;
    groups.getState().configureClientMode('desktop-continuous');
    const restored={panes:panes.getState().panes,groups:groups.getState().groups};
    // Restore existence checks are tested at their service boundary elsewhere; avoid real Host IO here.
    for(const id of Object.keys(panes.getState().panes))panes.getState().confirmRestoredPaneSession(id);
    for(const group of Object.values(groups.getState().groups)) {
      groups.getState().confirmRestoredPaneSession(group.id,'workspace-main');
      for(const id of Object.keys(group.panes))groups.getState().confirmRestoredPaneSession(group.id,id);
    }
    const fixture={scope,native,acp,claude,locale,events,panes,groups,restored,select:selectWorkbenchSession,split:placeWorkbenchSessionInSplit};
    window.__closing=fixture;
    function App(){
      const [sessionId,setSessionId]=useState(null);
      const [acpOpenRequest,setAcpOpenRequest]=useState(null);
      const [tabContainer,setTabContainer]=useState(null);
      fixture.openShellAcp=()=>setAcpOpenRequest({requestId:1,session:{...scope,id:acp.sessionId,agent:'codex',title:'Synthetic ACP',status:'idle',createdAt:0,updatedAt:0}});
      fixture.newTask=()=>{groups.getState().deactivateActiveGroup();panes.getState().resetToPrimaryPane();setSessionId(null)};
      return <main className="flex h-screen min-w-0 flex-col bg-background text-foreground"><header className="flex h-10 shrink-0 items-center px-2"><div ref={setTabContainer} className="min-w-0 flex-1"/></header><div className="min-h-0 flex-1"><V4WorkspaceChatArea {...scope}
        conversationTabsContainer={tabContainer}
        isDesktop sessionId={sessionId} acpOpenRequest={acpOpenRequest}
        onPrimaryAcpSessionArchived={id=>setAcpOpenRequest(current=>current?.session.id===id?null:current)}
        onPaneActiveSessionChange={(scope,id)=>{events.nativeSelections.push({scope,id});setSessionId(id)}}
        onSessionDeleted={()=>{events.nativeDeletes++;setSessionId(null)}}/></div></main>;
    }
    createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale={locale}><App/></ZCodeIntlProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  for (const locale of ["zh-CN", "en-US"]) {
    for (const width of [1280, 390]) {
      for (const dark of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        page.setDefaultTimeout(7000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/packages/ui/src/v4/SessionPane.tsx*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `
          import {ConversationHeader} from './ConversationHeader.tsx';
          export function SessionPane(props){
            const React=window.__React;
            const [draft,setDraft]=React.useState('');
            React.useEffect(()=>{
              const events=window.__closing.events;
              events.mounts[props.paneId]=(events.mounts[props.paneId]??0)+1;
              return ()=>{events.unmounts[props.paneId]=(events.unmounts[props.paneId]??0)+1};
            },[]);
            const session=props.acpBoundSessionId??props.acpOpenRequest?.session.id??props.sessionId;
            const agent=props.acpOpenRequest?.session.agent;
            const english=window.__closing.locale==='en-US';
            const title=session?(agent?agent+' conversation':english?'API conversation with a long title that must not crowd the other tabs':'API 对话的长标题需要截断显示，不能挤压其他标签和工具按钮'):(english?'New task':'新建任务');
            return React.createElement('section',{'data-testid':'conversation-'+props.paneId,'data-session':session??'','data-kind':props.acpBoundSessionId?'acp':'native',className:'relative flex h-full min-h-0 min-w-0 flex-col'},
              props.conversationTabContainer?window.__createPortal(React.createElement(window.__TabContent,{title,agent,model:'bigmodel-api/GLM-5.3',workspacePath:props.workspacePath,workspaceIdentity:props.workspaceIdentity}),props.conversationTabContainer):null,
              React.createElement(ConversationHeader,{title:session??'New conversation',onClosePane:props.onClosePane}),
              React.createElement('h2',{className:'p-4 pt-12 text-ui-base font-medium'},session?(props.acpBoundSessionId?'ACP':'API'):'New conversation'),
              React.createElement('p',{className:'p-4 text-ui-base'},session?'Synthetic running conversation':'Synthetic empty draft'),
              React.createElement('div',{className:'mt-auto flex gap-2 p-2'},
                React.createElement('button',{'data-testid':'removed-'+props.paneId,className:'text-ui-sm',onClick:()=>props.acpBoundSessionId?props.onAcpSessionArchived?.(session):props.onSessionDeleted?.()},'Session removed'),
                React.createElement('button',{'data-testid':'accepted-'+props.paneId,className:'text-ui-sm',onClick:()=>props.onSessionCreated?.('created-'+props.paneId)},'Session accepted')),
              React.createElement('textarea',{'data-testid':'draft-'+props.paneId,'aria-label':'Synthetic draft',value:draft,onChange:event=>setDraft(event.target.value),className:'m-2 h-20 min-w-0 border border-border bg-input p-2 text-mobile-input-safe'}));
          }`,
          }),
        );
        await page.route("**/packages/ui/src/v4/V4ConversationContext.tsx*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: "export function V4PaneConversationProvider({children}){return children}",
          }),
        );
        await page.route("**/packages/ui/src/hooks/useProviderSettingsView.ts*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: "const state={status:'ready',view:{providers:[{providerId:'bigmodel-api',effectiveConfig:{logo:{type:'builtin',key:'bigmodel'}}}]}};export function useProviderSettingsView(){return {state}};export function useProviderSettingsServiceView(){return {state}}",
          }),
        );
        await page.route("**/packages/ui/src/hooks/useWorkspaceServices.ts*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: "export function useWorkspaceServicesResolution(){return {isRemoteTarget:false,rpcReady:true,services:{}}}",
          }),
        );
        // 关闭/恢复场景只验证布局所有者；Git 读取由 paneGitStatus E2E 单独覆盖。
        await page.route("**/packages/ui/src/hooks/usePaneGitStatus.ts*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: "export function usePaneGitStatus(){return {}}",
          }),
        );
        const pane = (id) => page.locator(`[data-pane-id="${id}"]`);
        const close = async (id) => {
          await pane(id).getByTestId("v4-split-close").click();
          await pane(id).waitFor({ state: "detached" });
        };
        const snapshot = () =>
          page.evaluate(() => {
            const { panes, groups, events } = window.__closing;
            return { layout: panes.getState(), groups: groups.getState(), events };
          });
        const fullPane = async (id) => {
          const box = await pane(id).boundingBox();
          assert.equal(box.width, width);
          assert.equal(box.height, 760);
          assert.equal(await pane(id).getByTestId("v4-split-close").count(), 0);
        };
        try {
          await page.goto(`${origin}/${name}.html?locale=${locale}`);
          await pane("workspace-main").waitFor();
          await page.getByRole("tab").waitFor();
          assert.equal(await page.getByRole("tab").count(), 1);
          await page.evaluate((dark) => {
            document.documentElement.classList.toggle("dark", dark);
            document.documentElement.dataset.theme = dark ? "zai-dark" : "zai-light";
          }, dark);
          await page.evaluate(() => {
            const { panes, native, acp } = window.__closing;
            panes.getState().splitPaneWithBinding("workspace-main", "right", native);
            panes.getState().splitPaneWithBinding("pane-1", "down", acp);
          });
          await page.getByTestId("draft-pane-1").fill("API draft retained");
          await page.getByTestId("draft-pane-2").fill("ACP draft retained");
          assert.equal(await page.getByRole("tab").count(), 3);
          await page.evaluate(() => {
            const { panes, claude } = window.__closing;
            panes.getState().splitPaneWithBinding("workspace-main", "down", claude);
          });
          const claudeTab = page.getByTestId("workbench-conversation-tab-pane-3");
          await claudeTab.locator('[data-acp-agent-icon="claude"]').waitFor();
          assert.equal(await page.getByRole("tab").count(), 4);
          await claudeTab.click();
          assert.equal(await pane("pane-3").getAttribute("data-focused"), "true");
          await page.waitForFunction(() =>
            Array.from(document.querySelectorAll('[role="tab"] img')).every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({
            path: join(artifacts, `${locale}-${width}-${dark}-four-tabs.png`),
          });
          await close("pane-3");
          assert.equal(await page.getByRole("tab").count(), 3);
          const nativeTab = page.getByTestId("workbench-conversation-tab-pane-1");
          const acpTab = page.getByTestId("workbench-conversation-tab-pane-2");
          assert.equal(
            await nativeTab.locator('[data-task-provider-id="bigmodel-api"]').count(),
            1,
          );
          assert.equal(await acpTab.locator('[data-acp-agent-icon="codex"]').count(), 1);
          for (const tab of [nativeTab, acpTab])
            assert.equal(
              await tab
                .locator("img")
                .evaluate((image) => image.complete && image.naturalWidth > 0),
              true,
            );
          await nativeTab.click();
          assert.equal(await pane("pane-1").getAttribute("data-focused"), "true");
          const selectionCount = (await snapshot()).events.nativeSelections.length;
          await acpTab.click();
          assert.equal(await pane("pane-2").getAttribute("data-focused"), "true");
          assert.equal(await acpTab.getAttribute("aria-selected"), "true");
          assert.equal((await snapshot()).events.nativeSelections.length, selectionCount);
          await acpTab.press("Home");
          assert.equal(await pane("workspace-main").getAttribute("data-focused"), "true");
          await page.getByTestId("workbench-conversation-tab-workspace-main").press("End");
          assert.equal(await pane("pane-2").getAttribute("data-focused"), "true");
          await nativeTab.click();
          await page.screenshot({ path: join(artifacts, `${locale}-${width}-${dark}-before.png`) });
          await close("workspace-main");
          assert.equal(await page.locator("[data-pane-id]").count(), 2);
          assert.equal(await page.getByRole("tab").count(), 2);
          assert.equal(await page.getByTestId("draft-pane-1").inputValue(), "API draft retained");
          assert.equal(await page.getByTestId("draft-pane-2").inputValue(), "ACP draft retained");
          let state = await snapshot();
          assert.equal(state.events.mounts["pane-1"], 1);
          assert.equal(state.events.mounts["pane-2"], 1);
          assert.equal(state.events.unmounts["pane-1"], undefined);
          assert.equal(state.events.unmounts["pane-2"], undefined);
          assert.equal(state.layout.focusedPaneId, "pane-1");
          assert.ok(state.events.nativeSelections.some((event) => event.id === "shared-id"));
          await close("pane-1");
          await fullPane("pane-2");
          assert.equal(await page.getByRole("tab").count(), 1);
          assert.equal(await page.getByTestId("draft-pane-2").inputValue(), "ACP draft retained");
          await page.screenshot({
            path: join(artifacts, `${locale}-${width}-${dark}-single-acp.png`),
          });

          // Reload must not recreate the closed primary draft or misroute ACP through native APIs.
          await page.reload();
          await pane("pane-2").waitFor();
          await fullPane("pane-2");
          assert.equal(await page.getByRole("tab").count(), 1);
          assert.equal(
            await page.getByRole("tab").locator('[data-acp-agent-icon="codex"]').count(),
            1,
          );
          assert.equal(await pane("workspace-main").count(), 0);
          assert.equal(
            await page.evaluate(() => window.__closing.restored.panes["pane-2"].agent),
            "codex",
          );
          await page.getByTestId("removed-pane-2").click();
          await pane("workspace-main").waitFor();
          await fullPane("workspace-main");

          // A group keeps a sole typed ACP pane; hydrate it without recreating a primary binding.
          await page.evaluate(() => {
            const { groups, native, acp } = window.__closing;
            groups.getState().splitSessionIntoGroup("workspace-main", "right", acp, native);
            window.__closing.openShellAcp();
          });
          await page.getByTestId("draft-pane-1").fill("Group ACP draft retained");
          await close("workspace-main");
          await fullPane("pane-1");
          state = await snapshot();
          let group = state.groups.groups[state.groups.activeGroupId];
          assert.equal(group.primaryBinding, null);
          assert.equal(group.panes["pane-1"].kind, "acp");
          assert.equal(
            await page.getByTestId("draft-pane-1").inputValue(),
            "Group ACP draft retained",
          );
          // Removing the final pane must clear the old shell ACP request and native navigation.
          await page.getByTestId("removed-pane-1").click();
          await pane("workspace-main").waitFor();
          assert.equal(
            await page.getByTestId("conversation-workspace-main").getAttribute("data-session"),
            "",
          );
          await page.evaluate(() => {
            const { groups, native, acp } = window.__closing;
            groups.getState().splitSessionIntoGroup("workspace-main", "right", acp, native);
            groups.getState().closePane(groups.getState().activeGroupId, "workspace-main");
          });
          await page.reload();
          await pane("pane-1").waitFor();
          await fullPane("pane-1");
          state = await snapshot();
          group = state.groups.groups[state.groups.activeGroupId];
          assert.equal(group.primaryBinding, null);
          assert.equal(group.panes["pane-1"].workspaceScope.remoteSessionId, "attachment:fixture");
          await page.getByTestId("removed-pane-1").click();
          await pane("workspace-main").waitFor();
          assert.equal((await snapshot()).groups.activeGroupId, null);

          // Sidebar selection and split remain in the surviving layout, independent of stale shell.
          await page.evaluate(() => {
            const { panes, native } = window.__closing;
            panes.getState().splitPaneWithBinding("workspace-main", "right", native);
            panes.getState().closePane("workspace-main");
          });
          await pane("pane-1").waitFor();
          await page.evaluate(() => {
            const { select, split, scope, native } = window.__closing;
            select({ ...native, sessionId: "stale-shell" }, { ...scope, sessionId: "selected" });
            split(
              { ...native, sessionId: "stale-shell" },
              { ...scope, sessionId: "another" },
              { mode: "context-menu", side: "right" },
            );
          });
          await pane("pane-2").waitFor();
          assert.equal(await pane("workspace-main").count(), 0);
          assert.equal(
            await page.getByTestId("conversation-pane-1").getAttribute("data-session"),
            "selected",
          );
          await close("pane-2");
          await page.evaluate(() => {
            const { panes, scope } = window.__closing;
            panes.getState().splitPane("pane-1", "column", scope);
          });
          await page.getByTestId("accepted-pane-2").click();
          state = await snapshot();
          group = state.groups.groups[state.groups.activeGroupId];
          assert.equal(group.primaryBinding, null);
          assert.equal(group.panes["pane-2"].sessionId, "created-pane-2");
          await page.evaluate(() => window.__closing.newTask());
          await pane("workspace-main").waitFor();
          await fullPane("workspace-main");
          assert.equal(await page.locator("[data-pane-id]").count(), 1);
          assert.equal(await page.getByRole("tab").count(), 1);
          assert.equal(
            await page.getByTestId("conversation-workspace-main").getAttribute("data-session"),
            "",
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${locale}/${width}/${dark ? "dark" : "light"}: 1-4 tabs, API/Codex/Claude icons, tab focus, retain instances/drafts, reload, archive, split and new task`,
          );
        } finally {
          await page.close();
        }
      }
    }
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
