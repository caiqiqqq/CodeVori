// 合成 Host：只验证启动投影与读取，不调用 Agent 或用户仓库。
import assert from "node:assert/strict";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__work-task-startup-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-work-task-startup-"));
let browser;
const errors = [];
try {
  await writeFile(html, `<div id="root"></div><script type="module" src="./${name}.tsx"></script>`);
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkTasksPanel} from '../../../ui/src/work-tasks/WorkTasksPanel.tsx';
    import {WorkTasksSidebarButton} from '../../../ui/src/work-tasks/WorkTasksSidebarButton.tsx';
    import {useWorktreeProjectGroupsResolution} from '../../../ui/src/hooks/useWorktreeProjectGroups.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const main='/synthetic/iot-forway',child='/synthetic/worktrees/iot-forway',other='/synthetic/other/iot-forway';
    const tabs=[main,child,other].map(path=>({id:path,kind:'workspace',workspacePath:path,label:'iot-forway',workspacePurpose:'project'}));
    const state:any={git:[],calls:[],pendingGit:[],pendingList:[],defer:false,fail:false,title:'Initial task',listeners:new Map()};
    window.__startup=state;
    state.theme=applyTheme;
    const gitService:any={async getWorkspaceRepositoryInfo({workspacePath}:any){state.git.push(workspacePath);await new Promise(resolve=>state.pendingGit.push(resolve));return {workspacePath,repoRoot:workspacePath,isGitAvailable:true,kind:workspacePath===child?'linked-worktree':'main-tree',...(workspacePath===child?{mainWorktreePath:main}: {})}}};
    const makeService=(host:string)=>({
      async list(scope:any){state.calls.push({op:'list',host,path:scope.workspacePath});const result={tasks:scope.workspacePath===main?[{id:'task',workspacePath:main,title:state.title,prompt:'Synthetic task',status:'todo',archived:false,execution:{kind:'api',modelSelection:{providerId:'api',modelId:'SyntheticModel'},mode:'build'},createdAt:1,updatedAt:1}]:[],concurrency:1};if(state.fail)throw new Error('Synthetic read failure');if(state.defer){state.defer=false;await new Promise(resolve=>state.pendingList.push(resolve))}return result},
      onDynamicChanged:(scope:any)=>(listener:any)=>{const key=host+scope.workspacePath;const listeners=state.listeners.get(key)??new Set();state.listeners.set(key,listeners);listeners.add(listener);return {dispose:()=>listeners.delete(listener)}}
    });
    const services:any={gitService,workTaskService:makeService('A')};
    const nextServices:any={gitService,workTaskService:makeService('B')};
    state.finishGit=()=>{for(const resolve of state.pendingGit.splice(0))resolve()};
    state.finishList=()=>state.pendingList.shift()?.();
    state.notify=()=>{for(const listener of state.listeners.get('A'+main)??[])listener()};
    state.count=()=>[...state.listeners.values()].reduce((n,ls)=>n+ls.size,0);
    function Content(){
      const [currentTabs,setTabs]=useState(tabs);state.addProject=()=>setTabs([...tabs,{id:'new',kind:'workspace',workspacePath:'/synthetic/new/iot-forway',label:'iot-forway',workspacePurpose:'project'}]);
      const {resolvedGroups:groups,loading}=useWorktreeProjectGroupsResolution(currentTabs as any);
      const [visible,setVisible]=useState(true);state.hide=()=>setVisible(false);state.show=()=>setVisible(true);
      return <div className='flex h-dvh bg-background text-foreground'>
        <aside className='w-56 shrink-0'><WorkTasksSidebarButton projects={groups.filter(g=>!g.isLinkedWorktree).map(g=>g.tab)} projectsLoading={loading}/></aside>
        {visible?<main className='min-w-0 flex-1'><WorkTasksPanel workspacePath={main} workspaceTabs={currentTabs as any} onOpenConversation={()=>{}}/></main>:null}
      </div>;
    }
    function Fixture(){const [current,setCurrent]=useState(services);state.switchHost=()=>setCurrent(nextServices);state.unmount=()=>setCurrent(null);return current?<ServiceProvider services={current}><Content/></ServiceProvider>:null}
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL || "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("work-tasks-panel");
  const project = panel.getByTestId("work-task-project");
  await project.waitFor();
  assert.equal(await project.isDisabled(), true);
  await page.waitForFunction(() => window.__startup.git.length === 3);
  assert.deepEqual(await page.evaluate(() => window.__startup.calls), []);
  await page.screenshot({ path: join(artifacts, "loading.png") });
  await page.evaluate(() => window.__startup.finishGit());
  const card = panel.getByTestId("work-task-card");
  await card.waitFor().catch(async (error) => {
    console.error({
      body: await page.locator("body").innerText(),
      state: await page.evaluate(() => ({
        calls: window.__startup.calls,
        git: window.__startup.git,
        pending: window.__startup.pendingGit.length,
      })),
      errors,
    });
    throw error;
  });
  assert.deepEqual(
    await page.evaluate(() => window.__startup.calls.map((c) => c.path).sort()),
    ["/synthetic/iot-forway", "/synthetic/other/iot-forway"].sort(),
  );
  assert.equal(await page.evaluate(() => window.__startup.count()), 2);
  await project.click();
  assert.equal(await page.getByRole("option").count(), 2);
  assert.ok(
    (await page.getByRole("option").allTextContents()).every((label) =>
      label.includes("/synthetic/"),
    ),
  );
  assert.equal(
    await page.getByRole("option").filter({ hasText: "/synthetic/worktrees/" }).count(),
    0,
  );
  await page.screenshot({ path: join(artifacts, "projects.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__startup.defer = true;
    window.__startup.notify();
  });
  await page.waitForFunction(() => window.__startup.pendingList.length === 1);
  assert.ok((await card.innerText()).includes("Initial task"));
  await page.evaluate(() => {
    window.__startup.title = "Updated task";
    window.__startup.notify();
    window.__startup.finishList();
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="work-task-card"]')?.textContent.includes("Updated task"),
  );
  await page.evaluate(() => {
    window.__startup.fail = true;
    window.__startup.notify();
  });
  await panel.getByRole("alert").waitFor();
  assert.ok((await card.innerText()).includes("Updated task"));
  await page.evaluate(() => {
    window.__startup.fail = false;
    window.__startup.notify();
  });
  await panel.getByRole("alert").waitFor({ state: "detached" });
  const before = await page.evaluate(() => window.__startup.calls.length);
  await page.evaluate(() => window.__startup.hide());
  await panel.waitFor({ state: "detached" });
  await page.evaluate(() => window.__startup.show());
  await card.waitFor();
  assert.equal(await page.evaluate(() => window.__startup.calls.length), before);
  const beforeAddition = await page.evaluate(
    () => window.__startup.calls.filter((c) => c.path === "/synthetic/iot-forway").length,
  );
  await page.evaluate(() => window.__startup.addProject());
  await page.waitForFunction(() => window.__startup.pendingGit.length === 4);
  assert.equal(await project.isDisabled(), true);
  assert.ok((await card.innerText()).includes("Updated task"));
  assert.equal(
    await page.evaluate(
      () => window.__startup.calls.filter((c) => c.path === "/synthetic/iot-forway").length,
    ),
    beforeAddition,
  );
  await page.evaluate(() => window.__startup.finishGit());
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="work-task-project"]')?.hasAttribute("disabled"),
  );
  assert.ok((await card.innerText()).includes("Updated task"));
  await page.evaluate(() => {
    window.__startup.defer = true;
    window.__startup.notify();
  });
  await page.waitForFunction(() => window.__startup.pendingList.length === 1);
  await page.evaluate(() => {
    window.__startup.title = "New Host task";
    window.__startup.switchHost();
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="work-task-card"]')?.textContent.includes("New Host task"),
  );
  await page.evaluate(() => window.__startup.finishList());
  assert.ok((await card.innerText()).includes("New Host task"));
  assert.equal(await page.evaluate(() => window.__startup.count()), 3);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => window.__startup.theme(theme), theme);
    await page.setViewportSize({ width: 320, height: 780 });
    // 主应用手机侧栏由外层收起，此夹具也只保留实际手机内容区。
    await page.locator("aside").evaluate((element) => {
      element.style.display = "none";
    });
    await project.click();
    const menu = page.getByRole("listbox");
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 321);
    await page.screenshot({ path: join(artifacts, `mobile-${theme}.png`) });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => window.__startup.unmount());
  await page.waitForFunction(() => window.__startup.count() === 0);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS startup grouping, shared reads, event races, failure retention, Host isolation and cleanup. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
