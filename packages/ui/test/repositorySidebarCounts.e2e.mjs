// Synthetic Hosts only: no real Forge accounts, repositories or writes.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-counts-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-repository-counts-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepositorySidebarButton} from '../../../ui/src/repository-panel/RepositorySidebarButton.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {repositoryIssueRefreshStore} from '../../../ui/src/store/repositoryIssueRefreshStore.ts';
    import {repositoryNavigationStore} from '../../../ui/src/store/repositoryNavigationStore.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    applyTheme('zai-light');
    const state:any={calls:[],listeners:{A:new Set(),B:new Set()},counts:{A:0,B:6,other:2},incomplete:false,fail:true,delay:true,pending:[],open:false};
    const hosts:any={};
    for(const host of ['A','B'])hosts[host]={workTaskService:{
      async getRepositoryIssueSummary(input:any){
        state.calls.push({host,...input});
        const value={pending:state.counts[host]+(host==='A'&&input.projects.some(project=>project.workspacePath==='/synthetic/other')?state.counts.other:0),checkedAt:Date.now(),incomplete:host==='A'&&state.incomplete};
        if(state.delay){state.delay=false;await new Promise(resolve=>state.pending.push(resolve));}
        if(state.fail)throw new Error('FORGE_FORBIDDEN');
        return value;
      },
      onDynamicChanged:()=>listener=>{state.listeners[host].add(listener);return{dispose:()=>state.listeners[host].delete(listener)}}
    }};
    const project={workspacePath:'/synthetic/project'};
    const other={workspacePath:'/synthetic/other'};
    const remote={...project,workspaceIdentity:'synthetic-endpoint-b',remoteSessionId:'attachment-b'};
    const connect=()=>useRemoteWorkspaceSessionStore.setState({sessionsById:{'attachment-b':{services:hosts.B}},sessionIdByWorkspaceIdentity:{'synthetic-endpoint-b':'attachment-b'}} as any);
    state.finish=()=>state.pending.shift()?.();
    state.task=()=>{state.counts.A--;for(const listener of state.listeners.A)listener()};
    window.__counts=state;
    function Fixture(){
      const [projects,setProjects]=useState<any[]>([project,{...project}]);
      const [shown,setShown]=useState(true);
      const [open,setOpen]=useState(false);
      const [projectsLoading,setProjectsLoading]=useState(false);
      const {setLocale}=useZCodeIntl();
      state.switchRemote=()=>{connect();setProjects([remote])};
      return <div className='flex min-h-dvh gap-4 bg-background p-3 text-foreground'>
        <aside className='w-60 min-w-0 shrink-0'>
          {shown?<RepositorySidebarButton projects={projects} projectsLoading={projectsLoading} onClick={()=>setOpen(true)} active={open}/>:null}
        </aside>
        <main className='min-w-0 flex-1 space-y-2'>
          <h1>{open?'仓库视图':'聊天视图'}</h1>
          <div className='flex flex-wrap gap-2'>
            <button onClick={()=>state.counts.A++}>新增议题</button>
            <button onClick={state.task}>接入处理</button>
            <button onClick={()=>{state.fail=true}}>模拟失败</button>
            <button onClick={()=>{state.fail=false;repositoryIssueRefreshStore.getState().invalidate()}}>恢复</button>
            <button onClick={()=>setProjectsLoading(value=>!value)}>切换项目加载</button>
            <button onClick={()=>{state.counts.A=0;repositoryIssueRefreshStore.getState().invalidate()}}>关闭议题</button>
            <button onClick={()=>{state.counts.A=120;repositoryIssueRefreshStore.getState().invalidate()}}>大量议题</button>
            <button onClick={()=>setLocale('en-US')}>English</button>
            <button onClick={()=>applyTheme('zai-dark')}>深色</button>
            <button onClick={()=>{state.delay=true;repositoryIssueRefreshStore.getState().invalidate()}}>延迟查询</button>
            <button onClick={state.switchRemote}>切换远端</button>
            <button onClick={()=>useRemoteWorkspaceSessionStore.setState({sessionsById:{},sessionIdByWorkspaceIdentity:{}})}>断开远端</button>
            <button onClick={()=>useRemoteWorkspaceSessionStore.setState({sessionsById:{'attachment-b-2':{services:hosts.B}},sessionIdByWorkspaceIdentity:{'synthetic-endpoint-b':'attachment-b-2'}} as any)}>重连远端</button>
            <button onClick={()=>setProjects([project])}>同路径本机</button>
            <button onClick={()=>{state.counts.A=0;setProjects([project,other])}}>全部本机项目</button>
            <button onClick={()=>{connect();setProjects([project,other,remote])}}>加入远端项目</button>
            <button onClick={()=>{state.incomplete=true;repositoryIssueRefreshStore.getState().invalidate()}}>部分项目不可用</button>
            <button onClick={()=>{state.incomplete=false;repositoryIssueRefreshStore.getState().invalidate()}}>全部项目恢复</button>
            <button onClick={()=>repositoryNavigationStore.getState().selectRemote(project,'private')}>更换仓库</button>
            <button onClick={()=>setShown(false)}>卸载侧栏</button>
          </div>
        </main>
      </div>
    }
    createRoot(document.getElementById('root')!).render(<ServiceProvider services={hosts.A}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.clock.install({ time: new Date("2026-10-22T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-22T00:00:01Z"));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
  const badge = page.getByTestId("repository-sidebar-count");
  const entry = page.getByTestId("repository-sidebar-open");
  const expectCount = async (count) => {
    // 给 React 提交和读屏投影一帧时间；轮询间隔的精确边界由 Node fake-timer 用例验证。
    await page.clock.runFor(20);
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="repository-sidebar-count"]')?.textContent ===
        expected,
      String(count),
    );
  };
  const expectNoBadge = async () => {
    await page.clock.runFor(20);
    await entry.waitFor({ state: "visible" });
    await badge.waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("repository-sidebar-stale").count(), 0);
    assert.equal(await page.getByTestId("repository-sidebar-issue").count(), 0);
    assert.equal(await entry.isVisible(), true);
  };
  // 首次加载与首次失败都没有可用正数，不能用警告图标和横线制造待处理提示。
  await page.waitForFunction(() => window.__counts?.pending.length === 1);
  await expectNoBadge();
  assert.match(await entry.getAttribute("aria-description"), /正在获取/);
  await page.evaluate(() => window.__counts.finish());
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-sidebar-open"]')
      ?.getAttribute("aria-description")
      ?.includes("暂不可用"),
  );
  await expectNoBadge();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-sidebar-open"]')
      ?.getAttribute("aria-description")
      ?.startsWith("0"),
  );
  await expectNoBadge();
  await page.getByRole("button", { name: "模拟失败", exact: true }).click();
  await page.clock.runFor(60_000);
  await expectNoBadge();
  assert.match(await entry.getAttribute("aria-description"), /未能更新/);
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "新增议题", exact: true }).click();
  await page.getByRole("button", { name: "新增议题", exact: true }).click();
  await page.clock.runFor(60_000);
  await expectCount(2);
  assert.equal(await page.getByTestId("repository-sidebar-issue").isVisible(), true);
  await page.getByRole("button", { name: "切换项目加载", exact: true }).click();
  await expectNoBadge();
  await page.getByRole("button", { name: "切换项目加载", exact: true }).click();
  await expectCount(2);
  assert.equal(await page.getByRole("heading", { name: "聊天视图" }).count(), 1);
  assert.equal(
    await page.evaluate(() => window.__counts.calls[0].projects.length),
    1,
    "duplicate project is not queried twice",
  );
  await page.getByRole("button", { name: "新增议题", exact: true }).click();
  await page.clock.runFor(59_000);
  assert.equal(await badge.textContent(), "2");
  await page.clock.runFor(1_100);
  await expectCount(3);
  await page.getByRole("button", { name: "接入处理", exact: true }).click();
  await expectCount(2);
  await page.getByRole("button", { name: "模拟失败", exact: true }).click();
  await page.clock.runFor(60_000);
  await page.getByTestId("repository-sidebar-stale").waitFor();
  assert.equal(await badge.textContent(), "2");
  assert.match(await entry.getAttribute("aria-description"), /未能更新/);
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.clock.runFor(60_000);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="repository-sidebar-stale"]'),
  );
  await page.getByRole("button", { name: "关闭议题", exact: true }).click();
  await page.clock.runFor(20);
  await expectNoBadge();
  await page.getByRole("button", { name: "大量议题", exact: true }).click();
  await expectCount("99+");
  await page.getByRole("button", { name: "English", exact: true }).click();
  assert.equal(await entry.getAttribute("aria-label"), "Repository Panel");
  assert.match(await entry.getAttribute("aria-description"), /120 open issues/);
  for (const count of [99, 100]) {
    await page.evaluate((pending) => {
      window.__counts.counts.A = pending;
      for (const listener of window.__counts.listeners.A) listener();
    }, count);
    await expectCount(count === 99 ? "99" : "99+");
  }
  await entry.click();
  assert.equal(await page.getByRole("heading", { name: "仓库视图" }).count(), 1);
  await page.screenshot({ path: join(artifacts, "desktop-light.png") });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.clock.runFor(200);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await entry.isVisible(), true);
  const bounds = await entry.boundingBox();
  assert.ok(bounds && bounds.x + bounds.width <= 390);
  // CSS 颜色过渡由浏览器合成器推进；等待其完成，不能用 JS fake clock 猜测提交时间。
  await entry.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const colors = await page.evaluate(() => [
    getComputedStyle(document.querySelector('[data-testid="repository-sidebar-open"]')).color,
    getComputedStyle(document.querySelector("main")).color,
  ]);
  assert.equal(colors[0], colors[1], "entry uses the same readable foreground as the dark surface");
  await page.screenshot({ path: join(artifacts, "mobile-dark.png") });
  await page.setViewportSize({ width: 1120, height: 700 });
  // 当前项目没有议题时，其他项目的议题仍须显示；项目/Host 的失败不能清空成功部分。
  await page.getByRole("button", { name: "全部本机项目", exact: true }).click();
  await expectCount(2);
  assert.equal(await page.getByTestId("repository-sidebar-issue").isVisible(), true);
  assert.equal(await page.evaluate(() => window.__counts.calls.at(-1).projects.length), 2);
  await page.getByRole("button", { name: "部分项目不可用", exact: true }).click();
  await expectCount(2);
  assert.equal(await page.getByTestId("repository-sidebar-stale").isVisible(), true);
  assert.match(await entry.getAttribute("aria-description"), /Some projects are unavailable/);
  await page.getByRole("button", { name: "全部项目恢复", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="repository-sidebar-stale"]'),
  );
  await page.getByRole("button", { name: "加入远端项目", exact: true }).click();
  await expectCount(8);
  await page.getByRole("button", { name: "断开远端", exact: true }).click();
  await expectCount(2);
  assert.match(await entry.getAttribute("aria-description"), /Some projects are unavailable/);
  await page.screenshot({ path: join(artifacts, "multiple-projects-partial.png") });
  await page.getByRole("button", { name: "重连远端", exact: true }).click();
  await expectCount(8);
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="repository-sidebar-stale"]'),
  );
  await page.getByRole("button", { name: "同路径本机", exact: true }).click();
  await page.getByRole("button", { name: "大量议题", exact: true }).click();
  await expectCount("99+");
  await page.getByRole("button", { name: "延迟查询", exact: true }).click();
  await page.getByRole("button", { name: "切换远端", exact: true }).click();
  await expectCount(6);
  await page.evaluate(() => window.__counts.finish());
  await expectCount(6);
  const localCalls = await page.evaluate(
    () => window.__counts.calls.filter((call) => call.host === "A").length,
  );
  await page.getByRole("button", { name: "断开远端", exact: true }).click();
  await expectNoBadge();
  await page.clock.runFor(60_000);
  assert.equal(
    await page.evaluate(() => window.__counts.calls.filter((call) => call.host === "A").length),
    localCalls,
  );
  await page.getByRole("button", { name: "重连远端", exact: true }).click();
  await expectCount(6);
  assert.equal(
    await page.evaluate(() => window.__counts.calls.at(-1).projects[0].remoteSessionId),
    "attachment-b-2",
  );
  await page.getByRole("button", { name: "同路径本机", exact: true }).click();
  await expectCount("99+");
  await page.getByRole("button", { name: "更换仓库", exact: true }).click();
  await page.waitForFunction(() =>
    window.__counts.calls.some((call) => call.projects[0]?.remoteName === "private"),
  );
  await page.getByRole("button", { name: "卸载侧栏", exact: true }).click();
  const finalCalls = await page.evaluate(() => window.__counts.calls.length);
  await page.clock.runFor(120_000);
  assert.equal(await page.evaluate(() => window.__counts.calls.length), finalCalls);
  assert.equal(
    await page.evaluate(() => window.__counts.listeners.A.size + window.__counts.listeners.B.size),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", artifacts }));
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
