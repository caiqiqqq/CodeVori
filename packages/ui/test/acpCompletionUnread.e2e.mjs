// Production sidebar subscription + rows with a synthetic Host, no user history or model calls.
// pnpm exec tsx packages/ui/test/acpCompletionUnread.e2e.mjs
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__acp-unread-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const output = process.env.ZCODE_E2E_SCREENSHOT_DIR ?? "/tmp/zcode-104-preview";
let server;
let browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useAcpSidebarSessions} from '../../../ui/src/hooks/useAcpSidebarSessions.ts';
    import {useAcpTaskReadAcknowledgement} from '../../../ui/src/hooks/useAcpTaskReadAcknowledgement.ts';
    import {WorkspaceAcpTaskItem} from '../../../ui/src/WorkspaceAcpTaskItem.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const id='11111111-1111-4111-8111-111111111111';
    const tabs=['host:A','host:B'].map(workspaceIdentity=>({workspacePath:'/fixture/project',workspaceIdentity}));
    const listeners=new Map(),baselines=new Map(),calls=[],pending=[];
    const snapshots=new Map(tabs.map((scope,index)=>[scope.workspaceIdentity,{
      ...scope,id,agent:'codex',acpSessionId:'synthetic-native',revision:1,status:'running',
      title:index?'另一个项目的对话':'看看刚刚结束的对话',unreadAt:null,
      entries:[{kind:'user',id:'user:one',text:'synthetic',createdAt:100}],
    }]));
    const publish=(scope,value)=>{snapshots.set(scope,value);for(const fn of listeners.get(scope)??[])fn({kind:'updated',session:structuredClone(value)})};
    const acpService={
      listSummaries:scope=>new Promise(resolve=>baselines.set(scope.workspaceIdentity,resolve)),
      onDynamicSessionSummaryChanged:scope=>fn=>{
        const key=scope.workspaceIdentity;const set=listeners.get(key)??new Set();set.add(fn);listeners.set(key,set);
        return {dispose(){set.delete(fn)}};
      },
      updateRow:async input=>{
        calls.push(input);
        if(window.__unread.rejectWrites){throw new Error('synthetic persistence failure')}
        if(window.__unread.delay){await new Promise(resolve=>pending.push(resolve))}
        const value=snapshots.get(input.workspaceIdentity),action=input.action;
        if(action.kind==='unread'&&(action.unread||action.expectedUnreadAt===undefined||action.expectedUnreadAt===value.unreadAt)){
          publish(input.workspaceIdentity,{...value,revision:value.revision+1,unreadAt:action.unread?1000:null});
        }
        return structuredClone(snapshots.get(input.workspaceIdentity));
      },
    };
    const services={acpService};
    const lookup=new Map(tabs.map(tab=>[tab.workspaceIdentity,{services}]));
    function Fixture(){
      const rows=useAcpSidebarSessions(tabs,lookup);
      const [active,setActive]=useState(null),[variant,setVariant]=useState('default');
      const [showRows,setShowRows]=useState(true);
      useAcpTaskReadAcknowledgement(rows.find(row=>row.workspaceIdentity===active)??null,acpService,Boolean(active),false);
      window.__unread={...window.__unread,calls,pending,setActive,setVariant,setShowRows,
        emit(scope,patch){const previous=snapshots.get(scope);publish(scope,{...previous,...patch,revision:patch.revision??previous.revision+1})},
        baseline(scope,patch={}){baselines.get(scope)([{...snapshots.get(scope),...patch}])},
        get count(){return [...listeners.values()].reduce((sum,set)=>sum+set.size,0)},
      };
      return <div className='flex h-dvh bg-background text-foreground'>
        <aside className='w-80 max-w-full shrink-0 border-r border-border bg-sidebar p-3'>
          <div className='mb-5 text-ui-lg font-medium'>对话列表</div>
          {showRows&&tabs.map((tab,index)=><section key={tab.workspaceIdentity} data-scope={tab.workspaceIdentity} className='mb-5'>
            <div className='mb-2 text-ui-caption text-foreground-subtle'>{index?'其他项目':'当前项目'}</div>
            <ul>{rows.filter(row=>row.workspaceIdentity===tab.workspaceIdentity).map(row=><WorkspaceAcpTaskItem
              key={row.id} session={row} service={acpService} active={active===tab.workspaceIdentity}
              variant={variant} onSelect={()=>setActive(tab.workspaceIdentity)}/>)}</ul>
          </section>)}
        </aside>
        <main className='hidden flex-1 p-8 sm:block'><div className='text-ui-lg'>当前打开的对话</div>
          <div className='mt-4 text-ui-base text-foreground-subtle'>后台对话已经结束，左侧显示未读标记。打开后标记消失。</div></main>
      </div>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,isMacOS:false,isWindows:false,isLinux:true} as never}>
      <TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
    </PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 640 },
        deviceScaleFactor: 2,
      });
      page.setDefaultTimeout(10_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/${name}.html`);
      await page.waitForFunction(() => window.__unread?.count === 2);
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
      }, theme);
      const row = (scope) => page.locator(`[data-scope="${scope}"] [data-acp-session-id]`);
      const dot = (scope) => row(scope).locator('[data-unread-indicator="true"]');
      const emit = (scope, patch) =>
        page.evaluate(({ scope, patch }) => window.__unread.emit(scope, patch), { scope, patch });
      await emit("host:A", { status: "idle", unreadAt: 200 });
      await dot("host:A").waitFor();
      assert.equal(await dot("host:B").count(), 0);
      // A delayed initial read cannot replace live completion or its unread field.
      await page.evaluate(() => {
        window.__unread.baseline("host:A", { status: "running", revision: 1, unreadAt: null });
        window.__unread.baseline("host:B");
      });
      await row("host:B").waitFor();
      assert.equal(await dot("host:A").count(), 1);
      await page.screenshot({ path: join(output, `completed-unread-${width}-${theme}.png`) });
      await row("host:A").click();
      await dot("host:A").waitFor({ state: "detached" });
      const writes = await page.evaluate(() => window.__unread.calls);
      assert.equal(writes[0].action.expectedUnreadAt, 200);
      assert.equal(writes[0].workspaceIdentity, "host:A");
      // The current conversation finishes, then acknowledges that exact terminal result.
      await emit("host:A", { status: "running" });
      await row("host:A").locator("[data-acp-running-indicator]").waitFor();
      await emit("host:A", { status: "idle", unreadAt: 300 });
      await page.waitForFunction(() =>
        window.__unread.calls.some((item) => item.action.expectedUnreadAt === 300),
      );
      await dot("host:A").waitFor({ state: "detached" });
      await emit("host:A", { status: "running" });
      await row("host:A").locator("[data-acp-running-indicator]").waitFor();
      await page.evaluate(() => window.__unread.setShowRows(false));
      await row("host:A").waitFor({ state: "detached" });
      await emit("host:A", { status: "idle", unreadAt: 350 });
      await page.waitForFunction(() =>
        window.__unread.calls.some((item) => item.action.expectedUnreadAt === 350),
      );
      await page.evaluate(() => window.__unread.setShowRows(true));
      await row("host:A").waitFor();
      await dot("host:A").waitFor({ state: "detached" });
      // A manual unread update without an open/terminal edge remains unread.
      await emit("host:A", { unreadAt: 400 });
      await dot("host:A").waitFor();
      await page.evaluate(() => window.__unread.setActive(null));
      await row("host:A").waitFor();
      await page.evaluate(() => {
        window.__unread.delay = true;
      });
      await row("host:A").click();
      await page.waitForFunction(() => window.__unread.pending.length > 0);
      await emit("host:A", { unreadAt: 500 });
      await page.evaluate(() => {
        window.__unread.delay = false;
        window.__unread.pending.splice(0).forEach((resolve) => resolve());
      });
      assert.equal(await dot("host:A").count(), 1, "late acknowledgement keeps newer unread");
      await page.evaluate(() => window.__unread.setActive(null));
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-scope="host:A"] [data-selected]')
            ?.getAttribute("data-selected") === "false",
      );
      const beforeFailed = await page.evaluate(() => window.__unread.calls.length);
      await page.evaluate(() => {
        window.__unread.rejectWrites = true;
      });
      await row("host:A").click();
      await page.waitForFunction((count) => window.__unread.calls.length > count, beforeFailed);
      assert.equal(await dot("host:A").count(), 1, "failed persistence retains unread");
      await page.evaluate(() => {
        window.__unread.rejectWrites = false;
      });
      await emit("host:B", { status: "idle", unreadAt: 600 });
      await dot("host:B").waitFor();
      await row("host:B").click();
      await dot("host:B").waitFor({ state: "detached" });
      assert.equal(await dot("host:A").count(), 1, "same path/id on another Host is isolated");
      await page.evaluate(() => window.__unread.setVariant("timeline"));
      await dot("host:A").waitFor();
      assert.deepEqual(errors, []);
      console.log(`ACP completed unread: ${width}px ${theme} passed`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
