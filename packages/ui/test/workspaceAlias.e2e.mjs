import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__workspace-alias-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-workspace-alias-e2e-"));
let server, browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {WorkspaceSidebarItem} from '../../../ui/src/WorkspaceSidebarItem.tsx';
    import {ChatEmptyWorkspacePreviewMenu} from '../../../ui/src/ChatEmptyState.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {useSettings} from '../../../ui/src/hooks/useSettingService.ts';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';import '../../../ui/src/styles.css';
    const state:any={settings:{workspaceAliases:{}},writes:0,fail:false,navigation:0,notifications:[],hold:false};window.__alias=state;state.theme=applyTheme;
    const services:any={broadcastService:{send:async(message:any)=>{state.notifications.push(message)}},settingService:{get:async()=>state.settings,update:async(patch:any)=>{if(state.fail)throw Error('synthetic failure');if(state.hold)await new Promise<void>(resolve=>{state.release=resolve});const aliases={...state.settings.workspaceAliases,...patch.workspaceAliases};for(const key of Object.keys(aliases))if(!aliases[key])delete aliases[key];state.settings={...state.settings,workspaceAliases:aliases};state.writes++}},zcodeTaskService:{},acpService:{},zcodeAgentService:{}};
    useRemoteWorkspaceSessionStore.setState({baseServices:services});
    const listeners=new Set<()=>void>();state.broadcast=()=>listeners.forEach(f=>f());
    function Fixture(){const store=useTabStoreApi(),tabs=useTabStore(s=>s.tabs);const {settings,update}=useSettings(services);state.store=store;
      useEffect(()=>{store.getState().restoreTabs([{workspacePath:'/repo',workspaceIdentity:'remote:a:/repo',remoteTarget:{kind:'ssh',host:'synthetic.invalid',username:'test'}}, {workspacePath:'/repo',workspaceIdentity:'remote:b:/repo',remoteTarget:{kind:'ssh',host:'other.invalid',username:'test'}}],0)},[store]);
      useEffect(()=>{if(settings)store.getState().applyWorkspaceAliases(settings.workspaceAliases)},[settings,store,tabs]);
      return <main className='bg-background text-foreground min-h-dvh p-4'><ul className='max-w-80'>{tabs.map(tab=><div key={tab.id} data-scope={tab.workspaceIdentity}><WorkspaceSidebarItem tab={tab} isActiveWorkspace={false} isExpanded={false} activateTab={()=>{}} closeTab={()=>{}} toggleWorkspaceExpanded={()=>{state.navigation++}} onSelectTask={()=>{}} selectedNativeTaskId={null} onStartDraftInWorkspace={()=>{state.navigation++}} taskItems={[]} taskListLoading={false} taskListHasMore={false} onShowMoreTasks={()=>{}} reconnectingRemoteWorkspaceKeys={[]} remoteWorkspaceErrorByWorkspaceKey={{}} reconnectingRemoteWorkspaceLogsByWorkspaceKey={{}} onReconnectRemoteWorkspace={async()=>{}} workspaceAliases={settings?.workspaceAliases??{}} onRenameWorkspace={(target,alias)=>update({workspaceAliases:{[target.workspaceIdentity??target.workspacePath]:alias}})}/></div>)}</ul><div data-testid='composer-project'><ChatEmptyWorkspacePreviewMenu workspacePath='/repo' workspaceIdentity='remote:a:/repo' workspaceTabs={tabs.map(t=>({...t,remoteSessionId:'synthetic-session'}))} allowRemoteWorkspace={false} allowConversationWorkspaceDetach={false} onSelectWorkspace={()=>{}} onSelectConversationWorkspace={()=>{}} onOpenFolder={()=>{}} onConnectRemote={async()=>''} onSelectRemoteProject={async()=>{}} onCancelRemoteProject={async()=>{}}/></div></main>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,onSettingsChanged:(f:any)=>{listeners.add(f);return()=>listeners.delete(f)}} as any}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000) },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const rowA = page.locator('[data-scope="remote:a:/repo"]');
  const rowB = page.locator('[data-scope="remote:b:/repo"]');
  await rowA.getByText("repo", { exact: true }).waitFor();
  async function open(row) {
    await row.getByRole("button").first().focus();
    await row.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "重命名项目", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("menu").waitFor({ state: "hidden" });
  }
  const input = page.getByRole("textbox", { name: "重命名项目" });
  const confirm = page.getByRole("button", { name: "确认", exact: true });
  await open(rowA);
  await input.fill("  主项目  ");
  await input.press("Enter");
  await rowA.getByText("主项目", { exact: true }).waitFor();
  await page.getByTestId("composer-project").getByText("主项目", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__alias.notifications), [
    { channel: "settings:workspaceAliasesChanged", payload: null },
  ]);
  assert.equal(await rowB.getByText("repo", { exact: true }).count(), 1);
  assert.equal(
    await page.evaluate(() => window.__alias.navigation),
    0,
    "menu commands must not select or expand the workspace",
  );
  await open(rowA);
  await input.fill("取消的名称");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__alias.writes), 1);
  await open(rowA);
  await input.fill("bad/name");
  await confirm.click();
  await page
    .getByText("别名最多 200 个字符，不能包含路径分隔符或控制字符", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__alias.writes), 1);
  await input.fill("中文输入");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal(await page.evaluate(() => window.__alias.writes), 1);
  await input.dispatchEvent("compositionend");
  await page.evaluate(() => {
    window.__alias.fail = true;
  });
  await confirm.click();
  await page.getByText("保存项目别名失败", { exact: true }).waitFor();
  assert.equal(await rowA.getByText("主项目", { exact: true }).count(), 1);
  await page.evaluate(() => {
    window.__alias.fail = false;
  });
  await input.fill("");
  await confirm.click();
  await rowA.getByText("repo", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__alias.settings = { workspaceAliases: { "remote:a:/repo": "另一窗口命名" } };
    window.__alias.broadcast();
  });
  await rowA.getByText("另一窗口命名", { exact: true }).waitFor();
  await open(rowB);
  await input.fill("并发提交保护");
  await page.evaluate(() => {
    window.__alias.hold = true;
  });
  const writesBefore = await page.evaluate(() => window.__alias.writes);
  await confirm.click();
  await page.waitForFunction(() => Boolean(window.__alias.release));
  assert.equal(await confirm.isDisabled(), true);
  await input.dispatchEvent("keydown", { key: "Enter" });
  await page.evaluate(() => {
    window.__alias.hold = false;
    window.__alias.release();
  });
  await rowB.getByText("并发提交保护", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__alias.writes), writesBefore + 1);
  for (const width of [1280, 375])
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => window.__alias.theme(theme), theme);
      await open(rowB);
      const box = await page.getByRole("dialog").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await page.evaluate(async () => {
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
  assert.deepEqual(errors, []);
  console.log(`workspace alias E2E passed; screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
