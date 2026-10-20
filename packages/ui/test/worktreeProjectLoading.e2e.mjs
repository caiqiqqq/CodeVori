// Real sidebar and relation hook with delayed synthetic Git reads; no model or Git writes.
// ZCODE_E2E_VITE_URL=http://localhost:5174 node packages/ui/test/worktreeProjectLoading.e2e.mjs
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-loading-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const output = process.env.ZCODE_E2E_SCREENSHOT_DIR ?? "/tmp/zcode-worktree-loading";
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
    import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {persistSidebarTaskPreferences} from '../../../ui/src/lib/sidebarTaskPreferences.ts';
    import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {buildRemoteWorkspaceIdentity} from '../../../ui/src/lib/remoteWorkspaceHistory.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const main='/fixture/main',tree='/fixture/worktrees/one',newTree='/fixture/worktrees/two';
    const orphan='/fixture/worktrees/orphan',failed='/fixture/failed',plain='/fixture/non-git';
    const tab=(id,workspacePath)=>({id,kind:'workspace',label:id,workspacePath});
    const initial=[tab('main',main),tab('tree',tree)];
    const noop=()=>{},subscribe=()=>()=>({dispose(){}});
    const session={id:'tree-session',agent:'codex',title:'保留的工作树会话',workspacePath:tree,status:'ready',revision:1,createdAt:1,updatedAt:1,entries:[{kind:'user',text:'fixture',createdAt:1}]};
    const state={pending:[],reads:[],mounted:[],theme:applyTheme};window.__loading=state;
    const inspect=node=>{
      if(!(node instanceof Element))return;
      for(const row of [node,...node.querySelectorAll('[data-testid^="workspace-item-"]')]){
        const id=row.getAttribute('data-testid');
        if(id?.startsWith('workspace-item-'))state.mounted.push(id);
      }
    };
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(inspect))).observe(document.getElementById('root'),{childList:true,subtree:true});
    state.release=host=>{const pending=state.pending.filter(read=>read.host===host);state.pending=state.pending.filter(read=>read.host!==host);pending.forEach(read=>read.finish())};
    const services=host=>({
      settingService:{get:async()=>({}),onDynamicChanged:subscribe},
      gitService:{getWorkspaceRepositoryInfo:({workspacePath})=>new Promise((resolve,reject)=>{
        state.reads.push({workspacePath,host});
        const linked=[tree,newTree,orphan].includes(workspacePath);
        state.pending.push({workspacePath,host,finish:()=>workspacePath===failed?reject(new Error('Synthetic Git read failed')):resolve({workspacePath,kind:workspacePath===plain?'not-repository':linked?'linked-worktree':'main-tree',isGitAvailable:true,repoRoot:workspacePath,...(linked?{mainWorktreePath:workspacePath===orphan?'/fixture/unopened':main}:{})})});
      })},
      zcodeTaskService:{onDynamicWorkspaceEvent:subscribe,listTasks:async()=>[],listPinnedTaskIds:async()=>[],listPinnedTasks:async()=>[],listArchivedTasks:async()=>[],listDeletedTaskIds:async()=>[]},
      acpService:{list:async scope=>scope.workspacePath===tree?[session]:[],onDynamicSessionChanged:subscribe},
      windowControllerService:{onDynamicControllerFrame:subscribe,subscribeControllerV4:async()=>({ack:{subscriptionId:crypto.randomUUID()}}),unsubscribeControllerV4:async()=>{},listTaskList:async()=>({items:[],total:0,hasMore:false})},
    });
    const base=services('first');
    const registry=useRemoteWorkspaceSessionStore.getState();registry.registerBaseServices(base);
    registry.registerSession({sessionId:'remote',services:services('remote')});
    connectProviderSettingsSnapshot({getView:async()=>({revision:1,providers:[],providerTemplates:[],providerOrder:[]}),onDidChange:()=>({dispose(){}})});
    persistSidebarTaskPreferences({organizeBy:'project',sortBy:'updated'});
    function Fixture(){
      const api=useTabStoreApi(),[ready,setReady]=useState(false),[currentServices,setServices]=useState(base);
      useEffect(()=>{api.setState({tabs:initial,activeTabId:'tree',activeWorkspacePath:tree,expandedWorkspacePaths:new Set([main,tree])});setReady(true)},[]);
      state.add=(id,path)=>api.setState(s=>({tabs:[...s.tabs,tab(id,path)]}));
      state.remove=id=>api.setState(s=>({tabs:s.tabs.filter(tab=>tab.id!==id)}));
      state.remote=()=>{const target={kind:'ssh',host:'fixture.example.invalid',username:'tester'};api.setState(s=>({tabs:[...s.tabs,{...tab('remote',main),workspaceIdentity:buildRemoteWorkspaceIdentity(main,target),remoteTarget:target,remoteSessionId:'remote'}]}))};
      state.switchHost=()=>{const next=services('second');registry.registerBaseServices(next);setServices(next)};
      return ready?<ServiceProvider services={currentServices}><main data-testid='loading-fixture' className='h-dvh bg-sidebar text-foreground' style={{width:'min(320px,100vw)'}}>
        <WorkspaceSidebar workspacePath={tree} activeAcpSessionId={session.id} theme='zai-dark' isDesktop={false}
          onSelectTask={noop} onSelectAcpSession={noop} onStartDraftInWorkspace={noop} onCreateTask={noop} onCreateConversationTask={noop}
          onOpenFolderFromWorkspaceMenu={noop} onOpenCommandCenter={noop} onConnectRemote={noop} onSelectRemoteProject={noop}
          onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}}/>
      </main></ServiceProvider>:null;
    }
    const broadcast={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isLinux:true,isWindows:false}}><ServiceProvider services={base}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
      // 仅排除无关弹窗与页脚；真实项目行、关系 hook 和会话列表保持挂载。
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
      const fixture = page.getByTestId("loading-fixture");
      await fixture.waitFor().catch((error) => {
        throw new Error(errors.join("\n") || error.message);
      });
      await page.evaluate((theme) => window.__loading.theme(theme), theme);
      const project = (path) => fixture.getByTestId(`workspace-item-${path}`);
      const waitPending = (host, path) =>
        page.waitForFunction(
          ({ host, path }) =>
            window.__loading.pending.some(
              (read) => read.host === host && read.workspacePath === path,
            ),
          { host, path },
        );
      const release = (host) => page.evaluate((host) => window.__loading.release(host), host);
      const tree = "/fixture/worktrees/one";
      const newTree = "/fixture/worktrees/two";
      await waitPending("first", tree);
      assert.equal(await project(tree).count(), 0, "Startup must not mount a child project");
      assert.equal(await project("/fixture/main").count(), 0);
      assert.equal(await fixture.getByText("暂无项目", { exact: true }).count(), 0);
      await fixture.getByRole("status").filter({ hasText: "加载中" }).waitFor();
      await fixture.screenshot({ path: join(output, `${theme}-${width}-loading.png`) });
      await release("first");
      await project("/fixture/main").waitFor();
      const session = fixture.locator('[data-acp-session-id="tree-session"]');
      await session.waitFor();
      await page.evaluate(() => {
        window.__loading.projectNode = document.querySelector(
          '[data-testid="workspace-item-/fixture/main"]',
        );
        window.__loading.listNode = document.querySelector(
          '[data-project-workspace-path="/fixture/main"]',
        );
        window.__loading.add("new-tree", "/fixture/worktrees/two");
      });
      await waitPending("first", newTree);
      assert.equal(await project(newTree).count(), 0, "New worktrees wait for Git relations");
      assert.deepEqual(
        await page.evaluate(() => ({
          project:
            window.__loading.projectNode ===
            document.querySelector('[data-testid="workspace-item-/fixture/main"]'),
          list:
            window.__loading.listNode ===
            document.querySelector('[data-project-workspace-path="/fixture/main"]'),
        })),
        { project: true, list: true },
        "Confirmed project and conversation list must retain their instances",
      );
      await session.waitFor();
      assert.equal(await session.getAttribute("data-selected"), "true");
      await page.evaluate(() => window.__loading.remote());
      await fixture.getByText("remote", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.__loading.reads.some((read) => read.host === "remote")),
        false,
        "Remote projects must not use local Git relation queries",
      );
      await release("first");
      await page.waitForFunction(() =>
        document.querySelector(
          '[data-project-workspace-path="/fixture/main"] [data-acp-session-id="tree-session"]',
        ),
      );
      await page.evaluate(() => window.__loading.add("ordinary", "/fixture/ordinary"));
      await waitPending("first", "/fixture/ordinary");
      assert.equal(await project("/fixture/ordinary").count(), 0);
      await release("first");
      await project("/fixture/ordinary").waitFor();

      // 已移除路径的旧读取及旧 Host 返回，均不能污染当前关系投影。
      await page.evaluate(() => window.__loading.add("stale", "/fixture/stale"));
      await waitPending("first", "/fixture/stale");
      await page.evaluate(() => {
        window.__loading.remove("stale");
        window.__loading.switchHost();
      });
      await waitPending("second", tree);
      await release("first");
      assert.equal(
        await project("/fixture/main").count(),
        1,
        "Only the remote same-path project remains before the new Host resolves",
      );
      assert.equal(await project("/fixture/stale").count(), 0);
      await release("second");
      await session.waitFor();
      for (const [id, path] of [
        ["orphan", "/fixture/worktrees/orphan"],
        ["non-git", "/fixture/non-git"],
        ["failed", "/fixture/failed"],
      ]) {
        await page.evaluate(({ id, path }) => window.__loading.add(id, path), { id, path });
        await waitPending("second", path);
        assert.equal(await project(path).count(), 0);
        await release("second");
        await project(path).waitFor();
      }
      assert.deepEqual(
        await page.evaluate(() =>
          window.__loading.mounted.filter((id) =>
            [
              "workspace-item-/fixture/worktrees/one",
              "workspace-item-/fixture/worktrees/two",
              "workspace-item-/fixture/stale",
            ].includes(id),
          ),
        ),
        [],
        "Linked worktree rows must never mount, including between assertions",
      );
      assert.deepEqual(errors, []);
      await fixture.screenshot({ path: join(output, `${theme}-${width}-resolved.png`) });
      await page.close();
    }
  }
  process.stdout.write(
    "PASS: Startup/new projects wait for Git relations; existing conversations survive, stale reads are ignored and failed/orphan projects remain accessible (desktop/mobile, light/dark).\n",
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
