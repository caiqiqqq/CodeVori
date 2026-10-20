// Real shell, navigation and conversation tabs; synthetic header content, no Host or model requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__workbench-tab-scroll-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-workbench-tab-scroll-"));
let server, browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
    import {WorkspaceShellLayout} from '../../../ui/src/app-shell/WorkspaceShellLayout.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';import '../../../ui/src/styles.css';
    window.__React=React;window.__tabs={theme:applyTheme};const noop=()=>{},services={zcodeAgentService:{},zcodeSessionService:{}},platform={isWeb:true};
    function Fixture(){const [sidebar,setSidebar]=useState(false),[desktop,setDesktop]=useState(false);const ref=useRef(null);
      window.__tabs.sidebar=sidebar;window.__tabs.desktop=setDesktop;
      return <WorkspaceShellLayout services={services} platform={platform} workspaceAbsPath='/synthetic/tabs' workspaceMainView='chat' onWorkspaceMainViewChange={noop}
        workspaceTabs={[]} workspaceShellZCodeState={{draftFocusVersion:0,selectedProvider:'glm',activeTaskId:"synthetic-session"}} theme='zai-light'
        activeTaskId="synthetic-session" sidePaneOwnerId='draft' projectName='Synthetic' isWorkspaceVisible isDesktop={desktop} isMacDesktop={desktop} isWindowsDesktop={false} isMacFullscreen={false}
        isSidebarVisible={sidebar} isTerminalOpen={false} isSidePaneOpen={false} isBrowserOpen={false} supportsEmbeddedBrowser={false}
        gitState={{summary:{workspacePath:'/synthetic/tabs',isRepository:false},datasets:{staged:{sections:[]},unstaged:{sections:[]}}}} activeGitSourceId='unstaged' sidePaneState={{tabs:[],activeTabId:null}}
        handleToggleSidebar={()=>setSidebar(v=>!v)} handleToggleSidePane={noop} handleRefreshGit={noop} setGitSelectedSourceId={noop} handleBrowserUrlChange={noop} activeTaskTitle=''
        commandCenterCommands={[]} commandCenterWorkspaceTabs={[]} commandCenterOpen={false} onCommandCenterOpenChange={noop} onCommandCenterSearchResultHighlightRequest={noop} onCommandCenterOpenCodeViewer={noop}
        remoteWorkspaceSessions={[]} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}} browserRestoreUrls={{}} onOpenWorkspace={noop} onCreateTask={noop}
        onConnectRemote={noop} onSelectRemoteProject={noop} onCancelRemoteProject={noop} onReconnectRemoteWorkspace={noop} handleSelectTask={noop} handleStartDraftInWorkspace={noop}
        handleTaskNavBack={noop} handleTaskNavForward={noop} handleOpenAutomations={noop} handleOpenPluginStore={noop} handleOpenRepository={noop} handleOpenWorkTasks={noop}
        updateReadyVersion={null} updateState={null} desktopWindowChromeState={null} macWindowControlsLeftPaddingPx={96} sidebarContainerRef={ref} taskFindDialogProps={{}}
        taskNativeSessionLogFile={{path:null,provider:null,exists:false,loading:false}} taskSessionFile={{path:null}}/>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={{send(){},onMessage(){return {dispose(){}}}} as never}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 21000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "error",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 394, 1280]) {
    const page = await browser.newPage({
      viewport: { width, height: 852 },
      hasTouch: width < 768,
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const stub = (path, body) =>
      page.route(`**/packages/ui/src/${path}*`, (route) =>
        route.fulfill({ contentType: "application/javascript", body }),
      );
    for (const [path, symbol] of [
      ["WorkspaceSidebar.tsx", "WorkspaceSidebar"],
      ["command-center/CommandCenterDialog.tsx", "CommandCenterDialog"],
      ["quickpick/TaskFindDialog.tsx", "TaskFindDialog"],
      ["v4/V4WorkspaceChatArea.tsx", "V4WorkspaceChatArea"],
    ])
      await stub(path, `export function ${symbol}(){return null}`);
    await stub(
      "WorkspaceHeader.tsx",
      `
      import {WorkbenchConversationTabs} from '/@fs${resolve(desktop, "../ui/src/v4/WorkbenchConversationTabs.tsx")}';
      export function WorkspaceHeader(){const R=window.__React,[ids,setIds]=R.useState([]),[focus,setFocus]=R.useState('one');window.__tabs.open=values=>{setIds(values);setFocus(values[0])};window.__tabs.focus=setFocus;
        return R.createElement('header',{className:'relative flex w-full shrink-0 h-12 border-b'},R.createElement('div',{className:'flex h-12 flex-1 min-w-0 items-center justify-between gap-2 overflow-hidden p-2'},R.createElement('div',{className:'flex min-w-0 items-center gap-2 overflow-hidden flex-1'},R.createElement('span',{className:'size-8 shrink-0'},'▣'),R.createElement('div',{className:'min-w-0 flex-1'},ids.length?R.createElement(WorkbenchConversationTabs,{paneIds:ids,focusedPaneId:focus,onActivate:setFocus,onContentContainerChange:(_,el)=>{if(el)el.textContent='Synthetic tab'}}):null)),R.createElement('div',{className:'size-8 shrink-0'},'▢')));
      }`,
    );
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`, {
      timeout: 60000,
    });
    await page.waitForFunction(() => typeof window.__tabs?.open === "function");
    const toggle = page.getByRole("button", { name: "切换侧边栏", exact: true });
    await toggle.waitFor();
    if (width === 1280) await page.evaluate(() => window.__tabs.desktop(true));
    const position = () =>
      page.evaluate(() => {
        const shell = document.querySelector('[data-workspace-shell="true"]'),
          content = document.querySelector("#content"),
          button = document.querySelector('button[aria-label="切换侧边栏"]'),
          rect = button.getBoundingClientRect();
        return {
          shellLeft: shell.scrollLeft,
          shellWidth: shell.clientWidth,
          shellScrollWidth: shell.scrollWidth,
          contentWidth: content.getBoundingClientRect().width,
          buttonLeft: rect.left,
          buttonRight: rect.right,
          hit: button.contains(
            document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
          ),
        };
      });
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__tabs.theme(theme), theme);
      if (!(await page.evaluate(() => window.__tabs.sidebar))) await toggle.click();
      await page.waitForFunction(() => window.__tabs.sidebar);
      await page.evaluate(() => window.__tabs.open(["one"]));
      await page.getByRole("tab").waitFor();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const initial = await position();
      assert.equal(initial.shellLeft, 0, "Opening a conversation must not scroll the shell");
      assert.ok(
        initial.buttonLeft >= 0 && initial.buttonRight <= width && initial.hit,
        "Sidebar toggle must stay fully visible and clickable",
      );
      assert.ok(
        initial.shellScrollWidth <= initial.shellWidth + 1,
        "Expanded sidebar and main content must fit the workspace",
      );
      await page.evaluate(() =>
        window.__tabs.open(["one", "two", "three", "four", "five", "six", "seven", "eight"]),
      );
      const tab = (id) => page.getByTestId(`workbench-conversation-tab-${id}`);
      await tab("one").focus();
      await page.keyboard.press("End");
      await page.waitForFunction(() => document.querySelector('[role="tablist"]').scrollLeft > 0);
      assert.equal(await tab("eight").getAttribute("aria-selected"), "true");
      assert.equal(await tab("eight").evaluate((el) => el === document.activeElement), true);
      assert.equal((await position()).shellLeft, 0, "Keyboard focus must only scroll the tablist");
      await page.keyboard.press("Home");
      await page.waitForFunction(() => document.querySelector('[role="tablist"]').scrollLeft === 0);
      await page.keyboard.press("ArrowRight");
      assert.equal(await tab("two").getAttribute("aria-selected"), "true");
      await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
      if (width < 768) await toggle.tap();
      else await toggle.click();
      await page.waitForFunction(() => !window.__tabs.sidebar);
      assert.equal((await position()).shellLeft, 0);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS: real workspace shell/sidebar toggle and tabs, first open, overflow, keyboard local scroll, touch toggle, 320/394/1280px and light/dark. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
