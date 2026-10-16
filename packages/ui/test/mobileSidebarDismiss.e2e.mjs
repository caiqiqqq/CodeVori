// Real Shell, panel state owner, navigation and CSS; synthetic sidebar/content, no Host IO.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__mobile-sidebar-dismiss-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-mobile-sidebar-"));
let server, browser, page;
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
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '../../../ui/src/components/ui/dropdown-menu.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const noop=()=>{},platform:any={isWeb:true},services:any={};
    const state:any={contentClicks:0,sidebarClicks:0,menuClicks:0};window.__sidebar=state;
    window.__React=React;state.theme=applyTheme;
    window.__SidebarMenu=()=> <DropdownMenu><DropdownMenuTrigger asChild><button data-testid='sidebar-menu'>Menu</button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={()=>state.menuClicks++}>Portal action</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
    function Fixture(){
      const [desktop,setDesktop]=useState(false),[locale,setLocale]=useState('zh-CN'),[width,setWidth]=useState('100%'),[view,setView]=useState('work-tasks');
      state.desktop=setDesktop;state.locale=setLocale;state.width=setWidth;state.view=setView;
      const panels=useAppPanels({workspaceAbsPath:'/synthetic',activeTaskId:null,sidePaneOwnerId:'draft',isDesktop:desktop,supportsEmbeddedBrowser:false,defaultWhiteboardNamePrefix:'Board',platform});
      state.visible=panels.isSidebarVisible;
      const sidebarContainerRef=useRef(null);
      return <ZCodeIntlProvider initialLocale={locale} key={locale}><TooltipProvider><div style={{width}}>
        <WorkspaceShellLayout {...panels} services={services} platform={platform} workspaceAbsPath='/synthetic' workspaceMainView={view} onWorkspaceMainViewChange={setView}
          workspaceTabs={[]} workspaceShellZCodeState={{draftFocusVersion:0,selectedProvider:'glm',activeTaskId:null}} theme='zai-light'
          activeTaskId={null} sidePaneOwnerId='draft' projectName='Synthetic' isWorkspaceVisible isDesktop={desktop} isMacDesktop={false} isWindowsDesktop={false} isMacFullscreen={false}
          isSidePaneOpen={false} isBrowserOpen={false} supportsEmbeddedBrowser={false} gitState={{summary:null,datasets:{staged:{sections:[]},unstaged:{sections:[]}}}}
          gitWorktreeChangeSummary={{added:0,removed:0}} summaryPanelVariantOverride={null}
          handleToggleSidePane={panels.handleToggleSidePaneCollapse} handleRefreshGit={noop} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop}
          commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop}
          onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} handleSelectTask={noop} handleStartDraftInWorkspace={noop}
          handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={noop} handleOpenWorkTasks={noop}
          updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={0} sidebarContainerRef={sidebarContainerRef} taskFindDialogProps={{}}
          taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}/>
      </div></TooltipProvider></ZCodeIntlProvider>;
    }
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const stub = async (path, body) =>
    page.route(`**/packages/ui/src/${path}*`, (route) =>
      route.fulfill({ contentType: "application/javascript", body }),
    );
  for (const [path, symbol] of [
    ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
    ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
    ["WorkspaceHeader.tsx", "WorkspaceHeader"],
  ])
    await stub(path, `export function ${symbol}(){return null}`);
  await stub(
    "WorkspaceSidebar.tsx",
    `export function WorkspaceSidebar(){const R=window.__React;return R.createElement('div',{className:'h-full bg-sidebar text-foreground',style:{paddingTop:80}},R.createElement('button',{'data-testid':'sidebar-action',style:{display:'block',padding:8},onClick:()=>window.__sidebar.sidebarClicks++},'Sidebar action'),R.createElement(window.__SidebarMenu))}`,
  );
  const content = (symbol) =>
    `export function ${symbol}(){const R=window.__React;return R.createElement('div',{'data-testid':'fixture-content',className:'relative h-full bg-background text-foreground',style:{paddingTop:96}},R.createElement('button',{'data-testid':'content-action',style:{display:'block',width:'100%',height:64},onClick:()=>window.__sidebar.contentClicks++},'Content action'),R.createElement('textarea',{'data-testid':'draft',style:{display:'block',width:'100%',height:80},defaultValue:'保留草稿'}))}`;
  await stub("v4/V4WorkspaceChatArea.tsx", content("V4WorkspaceChatArea"));
  await stub("work-tasks/WorkTasksPanel.tsx", content("WorkTasksPanel"));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByTestId("fixture-content").waitFor();
  const visible = (expected) =>
    page.waitForFunction((v) => window.__sidebar.visible === v, expected);
  const toggle = () => page.getByRole("button", { name: /^(切换侧边栏|Toggle sidebar)$/ });
  const backdrop = page.getByTestId("mobile-sidebar-dismiss");
  const counts = () =>
    page.evaluate(() => ({
      content: window.__sidebar.contentClicks,
      sidebar: window.__sidebar.sidebarClicks,
      menu: window.__sidebar.menuClicks,
    }));
  const tapAt = async (locator) => {
    const box = await locator.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const open = async () => {
    await toggle().tap();
    await visible(true);
    // Wait for the production width transition through geometry, not a timer.
    await page.waitForFunction(
      () =>
        document.querySelector("#sidebar").getBoundingClientRect().width >=
        Math.min(264, document.querySelector("[data-workspace-shell]").clientWidth / 2) - 1,
    );
  };
  await visible(false);
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__sidebar.locale(locale), locale);
    await visible(false);
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__sidebar.theme(theme), theme);
      for (const width of [320, 390, 767]) {
        await page.setViewportSize({ width, height: 844 });
        await open();
        const draft = page.getByTestId("draft");
        const node = await draft.elementHandle();
        const before = await counts();
        await tapAt(page.getByTestId("content-action"));
        assert.equal(
          await page.evaluate(() => window.__sidebar.visible),
          false,
          "outside tap must close sidebar",
        );
        assert.equal((await counts()).content, before.content, "no click-through to content");
        assert.equal(await draft.inputValue(), "保留草稿");
        assert.ok(await node.evaluate((el) => el.isConnected), "content remains mounted");
        await page.getByTestId("content-action").tap();
        assert.equal((await counts()).content, before.content + 1, "second tap reaches content");
        await open();
        await tapAt(draft);
        await visible(false);
        assert.equal(
          await draft.evaluate((el) => el === document.activeElement),
          false,
          "no keyboard focus through backdrop",
        );
        await open();
        await page.getByTestId("sidebar-action").tap();
        assert.equal((await counts()).sidebar, before.sidebar + 1);
        await visible(true);
        await page.getByTestId("sidebar-menu").tap();
        await page.getByRole("menuitem", { name: "Portal action" }).tap();
        assert.equal((await counts()).menu, before.menu + 1);
        await visible(true);
        await page.screenshot({ path: join(artifacts, `${locale}-${theme}-${width}-open.png`) });
        await backdrop.focus();
        assert.equal(
          await backdrop.getAttribute("aria-label"),
          locale === "zh-CN" ? "收起侧边栏" : "Collapse sidebar",
        );
        await page.keyboard.press("Enter");
        await visible(false);
        await open();
        await toggle().tap();
        await visible(false);
        await node.dispose();
      }
    }
  }
  // Chat uses the same hit area; blank space must also close it. Keep the resize matrix
  // on the board so its manual opens don't race chat's existing debounced auto-collapse.
  await page.evaluate(() => window.__sidebar.view("chat"));
  await open();
  const box = await backdrop.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 20);
  await visible(false);
  await page.evaluate(() => window.__sidebar.view("work-tasks"));
  // Container width drives visibility even in a wide browser, without a second mobile state.
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.evaluate(() => window.__sidebar.width("390px"));
  await visible(false);
  await open();
  await backdrop.waitFor({ state: "visible" });
  await page.evaluate(() => window.__sidebar.width("100%"));
  await backdrop.waitFor({ state: "hidden" });
  await page.getByTestId("content-action").tap();
  await visible(true);
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await backdrop.waitFor({ state: "hidden" });
    await page.getByTestId("content-action").tap();
    await visible(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await visible(false);
  await open();
  await page.setViewportSize({ width: 844, height: 390 });
  await backdrop.waitFor({ state: "hidden" });
  // CSS 查询立即更新；让真实 ResizeObserver 也观察到横屏，再验证重新进入窄屏。
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await visible(false);
  await page.evaluate(() => window.__sidebar.desktop(true));
  await open();
  assert.equal(await backdrop.count(), 0, "Desktop never mounts backdrop");
  await page.getByTestId("content-action").tap();
  await visible(true);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real Shell outside tap without click/focus-through, draft/DOM retention, sidebar/portal actions, toggle/keyboard, narrow container, resize, Desktop/Web boundary, zh/en light/dark. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
