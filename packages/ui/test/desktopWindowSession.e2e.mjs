// Real window projection hook, Zustand navigation and composer; synthetic services, no model calls.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__desktop-window-${process.pid}`;
const html = join(root, name + ".html");
const moduleFile = join(root, name + ".tsx");
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {useDesktopWindowSession} from '../../../ui/src/root/useDesktopWindowSession.ts';
import {useDesktopWindowView} from '../../../ui/src/root/desktopWindowSession.ts';
import {DesktopWindowDraftLanding} from '../../../ui/src/root/DesktopWindowDraftLanding.tsx';
import {useZCodeSessionStore} from '../../../ui/src/store/zcodeSessionStore.ts';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import {useConversationWorkspaceActions} from '../../../ui/src/root/useConversationWorkspaceActions.ts';
import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
const state={listener:null,resolve:null,published:[],prepared:[],sent:[],ensured:0,actionError:null};
const services={windowControllerService:{getWorkspaceSession:()=>new Promise(resolve=>state.resolve=resolve),onDynamicWorkspaceSessionChanged:()=>listener=>{state.listener=listener;return{dispose(){state.listener=null}}},publishWorkspaceSession:async value=>state.published.push(value)},
clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},fileService:{searchWorkspaceFiles:async()=>[],ensureConversationWorkspace:async()=>{state.ensured++;return {path:'/new-unowned'}}},pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})}};
const follower={prepare:async snapshot=>{state.prepared.push(snapshot);if(snapshot.workspaces.some(item=>item.workspaceIdentity==='invalid'))throw Error('scope unavailable')}};
const platform={isMacOS:false,isWindows:false,isLinux:true,isWeb:true};const noop=()=>{};
useZCodeSessionStore.setState({workspaces:{'/conversation':{...useZCodeSessionStore.getState().getWorkspaceState('/conversation'),activeTaskId:'old-conversation'}}});
function Fixture(){
const store=useTabStoreApi();window.__desktopFixture={...state,emit:value=>state.listener(value),resolve:value=>state.resolve(value),state,store,sessions:useZCodeSessionStore,applyTheme};
const result=useDesktopWindowSession({services:services as never,ready:true,follower});
const actions=useConversationWorkspaceActions({services:services as never,addTab:store.getState().addTab,setWorkspaceActionError:error=>state.actionError=error});
window.__desktopFixture.createConversation=actions.handleCreateConversationTask;
const tabs=useTabStore(state=>state.tabs);const active=useTabStore(state=>state.activeTabId);const tab=tabs.find(tab=>tab.id===active);
const snapshot=useDesktopWindowView(state=>state.snapshot);const [drafts,setDrafts]=useState({});
const key=tab?.workspaceIdentity||tab?.workspacePath;const draft=drafts[key]??{text:'',updatedAt:0};
const update=useCallback(content=>setDrafts(current=>({...current,[key]:{...current[key],...content,updatedAt:Date.now()}})),[key]);
const replace=useCallback(content=>setDrafts(current=>({...current,[key]:{...content,updatedAt:Date.now()}})),[key]);
if(result.error)return <p role="alert">{result.error}</p>;if(result.loading)return <p>waiting</p>;
if(!tab)return <DesktopWindowDraftLanding workspaces={tabs} onSelectWorkspace={workspace=>{store.getState().activateTab(workspace.id);useZCodeSessionStore.getState().startDraft(workspace.workspacePath,undefined,workspace.workspaceIdentity)}}/>;
return <main className="h-screen flex flex-col p-3 bg-background text-foreground"><ul>{tabs.map(item=><li key={item.id}><button data-identity={item.workspaceIdentity||item.workspacePath} onClick={()=>store.getState().activateTab(item.id)}>{item.label}</button></li>)}</ul>
<output data-testid="sort">{snapshot?.sidebar.sortBy}</output><div className="mt-auto">
{tab?<ConversationComposer snapshot={{sessionId:'synthetic',config:{mode:'build',followupMode:'queue'},inputRouting:{mode:'startNow'},control:{canStop:false,phase:'idle'},rows:{totalCount:0},usage:null,queue:{items:[]},backgroundWorks:[]} as never}
sessionId="synthetic" workspacePath={tab.workspacePath} workspaceIdentity={tab.workspaceIdentity} remoteSessionId={tab.remoteSessionId}
composerDraft={draft} updateComposerContent={update} replaceComposerDraft={replace} attachmentPut={async()=>{throw Error('Unexpected attachment')}} attachmentSessionId="synthetic"
onSendText={async text=>{state.sent.push({key,text});return 'sent'}} onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop} autoFocusEnabled={false} listenAddToChatEvents={false}/>:null}</div></main>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const [width, theme] of [
    [320, "zai-light"],
    [390, "zai-dark"],
    [1280, "zai-light"],
    [1280, "zai-dark"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      Object.defineProperty(crypto, "randomUUID", { value: undefined }),
    );
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5189"}/${name}.html`);
    await page.waitForFunction(
      () => window.__desktopFixture?.state.listener && window.__desktopFixture.state.resolve,
    );
    await page.evaluate((theme) => window.__desktopFixture.applyTheme(theme), theme);
    const first = {
      epoch: "existing-host",
      revision: 3,
      workspaces: [
        { workspacePath: "/same", workspaceIdentity: "remote-A", remoteSessionId: "session-A" },
        { workspacePath: "/same", workspaceIdentity: "remote-B", remoteSessionId: "session-B" },
      ],
      sidebar: { organizeBy: "project", sortBy: "updated" },
    };
    // A project is first in desktop order; cold phone entry must use the existing conversation draft.
    await page.evaluate(
      (snapshot) =>
        window.__desktopFixture.emit({
          ...snapshot,
          revision: 1,
          workspaces: [
            ...snapshot.workspaces,
            { workspacePath: "/conversation", workspacePurpose: "conversation" },
          ],
        }),
      first,
    );
    const input = page.getByTestId("v4-composer-input");
    await input.waitFor();
    assert.equal(
      await page.evaluate(() => window.__desktopFixture.store.getState().activeWorkspacePath),
      "/conversation",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__desktopFixture.sessions.getState().getWorkspaceState("/conversation")
            .activeTaskId,
      ),
      null,
    );
    await input.fill("保留的对话草稿");
    // A subsequent snapshot must not reset a conversation the user has since opened.
    await page.evaluate((snapshot) => {
      const sessions = window.__desktopFixture.sessions;
      sessions.setState({
        workspaces: {
          ...sessions.getState().workspaces,
          "/conversation": {
            ...sessions.getState().getWorkspaceState("/conversation"),
            activeTaskId: "user-selected",
          },
        },
      });
      window.__desktopFixture.emit({
        ...snapshot,
        revision: 2,
        workspaces: [
          { workspacePath: "/conversation", workspacePurpose: "conversation" },
          ...snapshot.workspaces,
        ],
      });
    }, first);
    await page.waitForFunction(() => window.__desktopFixture.state.prepared.length === 2);
    assert.equal(await input.textContent(), "保留的对话草稿");
    assert.equal(
      await page.evaluate(
        () =>
          window.__desktopFixture.sessions.getState().getWorkspaceState("/conversation")
            .activeTaskId,
      ),
      "user-selected",
    );
    // Removing the active workspace must never fall back to the first project.
    await page.evaluate((snapshot) => window.__desktopFixture.emit(snapshot), first);
    const landing = page.getByTestId("desktop-window-draft-landing");
    await landing.waitFor();
    assert.equal(
      await page.evaluate(() => window.__desktopFixture.store.getState().activeWorkspacePath),
      null,
    );
    assert.equal(await input.count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: `/tmp/zcode-180-${width}-${theme}.png` });
    await page.evaluate(() => window.__desktopFixture.createConversation());
    assert.equal(
      await page.evaluate(() => window.__desktopFixture.state.ensured),
      0,
      "Phone must not create a backing workspace outside desktop membership",
    );
    assert.equal(await page.locator('[data-identity="/new-unowned"]').count(), 0);
    await landing.getByRole("button", { name: /remote-B/ }).click();
    const activeId = await page.evaluate(
      () => window.__desktopFixture.store.getState().activeTabId,
    );
    await input.click();
    await input.fill("手机未发送草稿");
    // Late startup response and an older event must not roll the sidebar back.
    await page.evaluate((snapshot) => {
      window.__desktopFixture.resolve({ ...snapshot, revision: 1, workspaces: [] });
      window.__desktopFixture.emit({ ...snapshot, revision: 2, workspaces: [] });
    }, first);
    await page.evaluate(
      (snapshot) =>
        window.__desktopFixture.emit({
          ...snapshot,
          revision: 4,
          workspaces: [...snapshot.workspaces].reverse(),
          sidebar: { organizeBy: "project", sortBy: "created" },
        }),
      first,
    );
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sort"]').textContent === "created",
    );
    assert.deepEqual(
      await page
        .locator("[data-identity]")
        .evaluateAll((items) => items.map((item) => item.dataset.identity)),
      ["remote-B", "remote-A"],
    );
    assert.equal(
      await page.evaluate(() => window.__desktopFixture.store.getState().activeTabId),
      activeId,
    );
    assert.equal(await input.textContent(), "手机未发送草稿");
    assert.equal(await page.getByTestId("v4-composer-send").isEnabled(), true);
    await page.getByTestId("v4-composer-send").click();
    await page.waitForFunction(() => window.__desktopFixture.state.sent.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__desktopFixture.state.sent[0]), {
      key: "remote-B",
      text: "手机未发送草稿",
    });
    await page.evaluate(
      (snapshot) =>
        window.__desktopFixture.emit({
          ...snapshot,
          revision: 5,
          workspaces: [snapshot.workspaces[0]],
        }),
      first,
    );
    await page.locator('[data-identity="remote-B"]').waitFor({ state: "detached" });
    await landing.waitFor();
    assert.equal(
      await page.evaluate(() => window.__desktopFixture.store.getState().activeTabId),
      null,
    );
    // Empty membership remains a visible new-task page, with no selectable project.
    await page.evaluate(
      (snapshot) => window.__desktopFixture.emit({ ...snapshot, revision: 6, workspaces: [] }),
      first,
    );
    await landing.getByText("尚未打开项目").waitFor();
    assert.equal(await landing.getByRole("button").count(), 0);
    assert.deepEqual(
      await page.evaluate(() => window.__desktopFixture.state.published),
      [],
      "Phone never publishes desktop membership",
    );
    await page.evaluate(
      (snapshot) =>
        window.__desktopFixture.emit({
          ...snapshot,
          revision: 7,
          workspaces: [
            { workspacePath: "/same", workspaceIdentity: "invalid", remoteSessionId: "stale" },
          ],
        }),
      first,
    );
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").textContent(), /scope unavailable/);
    assert.equal(
      await page.getByTestId("v4-composer-input").count(),
      0,
      "Failed scope cannot expose a local composer",
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS draft landing, membership, stale snapshot, identity and composer ${width}px ${theme}`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
