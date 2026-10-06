// Isolated synthetic Hosts only; no user tasks, credentials or model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__work-task-counts-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-work-task-counts-"));
let browser;
const errors = [];
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
    import {WorkTasksSidebarButton} from '../../../ui/src/work-tasks/WorkTasksSidebarButton.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider, useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider, useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const state:any={calls:[],rows:{local:{},A:{},B:{}},listeners:{local:{},A:{},B:{}},pending:[],defer:null,fail:null};
    window.__counts=state;
    state.setTheme=applyTheme;
    const key=(scope:any)=>scope.workspaceIdentity?.trim()||scope.workspacePath;
    const makeRows=(statuses:string[])=>statuses.map((status,i)=>({id:'task-'+i,status,archived:false,execution:i%2?{kind:'acp',agent:'codex',config:[]}:{kind:'api',modelSelection:{providerId:'api',modelId:'model'},mode:'build'}}));
    state.rows.local['/synthetic/one']=makeRows(['preparing','running','done','queued','awaiting_input','review','failed','canceled']);
    state.rows.local['/synthetic/one'].push(...makeRows(['running','awaiting_input','review','failed','done']).map(row=>({...row,archived:true})));
    state.rows.local['/synthetic/two']=makeRows(['running','done','review']);
    state.rows.local['/synthetic/default']=makeRows(['running','done']);
    state.rows.local['/synthetic/shared']=makeRows(['running']);
    state.rows.A['remote-a']=makeRows(['running','review']);
    state.rows.A['/synthetic/legacy']=makeRows(['awaiting_input','failed']);
    state.rows.B['remote-b']=makeRows(['review','awaiting_input']);
    const hosts:any={};
    for(const host of ['local','A','B']){
      const service:any={
        async list(scope:any){const scopeKey=key(scope);state.calls.push({op:'list',host,...scope});if(state.fail===scopeKey)throw new Error('Synthetic read failed');const result=structuredClone({tasks:(state.rows[host][scopeKey]||[]).filter((task:any)=>!task.archived),concurrency:1});if(state.defer===scopeKey){state.defer=null;return new Promise(resolve=>state.pending.push(()=>resolve(result)))}return result},
        onDynamicChanged:(scope:any)=>(listener:any)=>{const scopeKey=key(scope);const listeners=state.listeners[host][scopeKey]??=new Set();listeners.add(listener);return {dispose(){listeners.delete(listener)}}},
      };
      for(const op of ['create','update','start','startAll','cancel','complete','archive','setConcurrency'])service[op]=()=>{state.calls.push({op,host});throw new Error('Counts must remain read-only')};
      hosts[host]={workTaskService:service};
    }
    const remote=useRemoteWorkspaceSessionStore.getState;
    remote().registerBaseServices(hosts.local);
    state.connect=(host:string)=>{remote().registerSession({sessionId:host,services:hosts[host]});remote().bindWorkspaceIdentity(host==='A'?'remote-a':'remote-b',host)};
    state.disconnect=(host:string)=>remote().unregisterSession(host);
    state.connect('A');state.connect('B');
    state.unsupported=()=>remote().registerBaseServices({});state.supported=()=>remote().registerBaseServices(hosts.local);
    state.notify=(host:string,scopeKey:string)=>{for(const listener of state.listeners[host][scopeKey]||[])listener()};
    state.replace=(host:string,scopeKey:string,statuses:string[])=>{state.rows[host][scopeKey]=makeRows(statuses);state.notify(host,scopeKey)};
    state.finish=()=>state.pending.shift()?.();
    const projects=[{workspacePath:'/synthetic/one',workspacePurpose:'project'},{workspacePath:'/synthetic/two',workspacePurpose:'project'},{workspacePath:'/synthetic/one',workspacePurpose:'project'},{workspacePath:'/synthetic/default',workspacePurpose:'conversation'}];
    state.defer='/synthetic/two';
    function Fixture(){const [tabs,setTabs]=useState(projects);const [active,setActive]=useState(false);const {setLocalePreference}=useZCodeIntl();const tabStore=useTabStoreApi();state.setProjects=setTabs;state.setLocale=setLocalePreference;
      state.activateRemote=()=>tabStore.setState({activeTabId:'remote-tab',activeWorkspacePath:'/synthetic/shared',activeWorkspaceIdentity:'remote-a',tabs:[{id:'remote-tab',kind:'workspace',label:'Remote A',workspacePath:'/synthetic/shared',workspaceIdentity:'remote-a',remoteSessionId:'A',workspacePurpose:'project'},{id:'local-tab',kind:'workspace',label:'Local',workspacePath:'/synthetic/shared',workspacePurpose:'project'}]});
      return <ServiceProvider services={hosts.A}><div className='h-dvh bg-background text-foreground'><nav data-testid='counts-sidebar' className='w-64 max-w-full bg-sidebar p-3'><WorkTasksSidebarButton projects={tabs} active={active} onClick={()=>{state.calls.push({op:'navigate'});setActive(v=>!v)}}/></nav><main>{active?'Synthetic task view':'Synthetic conversation view'}</main></div></ServiceProvider>}
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  await page.waitForLoadState("networkidle");
  const button = page.getByTestId("work-tasks-sidebar-open");
  const expectCounts = async (running, waiting) => {
    await page.waitForFunction(
      ({ running, waiting }) => {
        const matches = (status, count) => {
          const value = document.querySelector(`[data-testid="work-tasks-sidebar-${status}"]`);
          const icon = document.querySelector(`[data-testid="work-tasks-sidebar-${status}-icon"]`);
          return count === 0
            ? value === null && icon === null
            : value?.textContent?.trim() === String(count) && icon !== null;
        };
        return (
          matches("running", running) &&
          matches("waiting", waiting) &&
          Boolean(document.querySelector('[data-testid="work-tasks-sidebar-counts"]')) ===
            (running !== 0 || waiting !== 0)
        );
      },
      { running, waiting },
    );
  };
  await expectCounts("-", "-");
  assert.equal(await button.getAttribute("aria-description"), "正在读取任务数量");
  await page.evaluate(() => window.__counts.finish());
  await expectCounts(3, 4);
  assert.match(await button.getAttribute("aria-description"), /执行中 3，等待处理 4/);
  assert.equal(
    await button.locator('svg[data-testid="work-tasks-sidebar-running-icon"]').count(),
    1,
  );
  assert.equal(
    await button.locator('svg[data-testid="work-tasks-sidebar-waiting-icon"]').count(),
    1,
  );
  assert.equal((await button.innerText()).replace(/\s+/g, ""), "待办任务34");
  assert.equal(await button.getByTestId("work-tasks-sidebar-done").count(), 0);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__counts.calls
        .filter((c) => c.op === "list")
        .map((c) => [c.host, c.workspacePath])
        .sort(),
    ),
    [
      ["local", "/synthetic/one"],
      ["local", "/synthetic/two"],
    ],
  );
  assert.equal(
    await page.evaluate(() => window.__counts.listeners.local["/synthetic/one"].size),
    1,
  );

  // Updates remain live while the user is in a conversation rather than the board.
  await page.evaluate(() =>
    window.__counts.replace("local", "/synthetic/one", ["running", "running", "running", "done"]),
  );
  await expectCounts(4, 1);
  await button.click();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  await button.click();
  assert.equal(await button.getAttribute("aria-pressed"), "false");
  await page.evaluate(() =>
    window.__counts.replace("local", "/synthetic/one", [
      "review",
      "done",
      "failed",
      "awaiting_input",
    ]),
  );
  await expectCounts(1, 4);
  await page.evaluate(() => window.__counts.replace("local", "/synthetic/one", ["done", "done"]));
  await expectCounts(1, 1);
  await page.evaluate(() =>
    window.__counts.replace("local", "/synthetic/one", ["review", "awaiting_input"]),
  );
  await expectCounts(1, 3);
  await page.evaluate(() => {
    window.__counts.rows.local["/synthetic/one"][0].archived = true;
    window.__counts.notify("local", "/synthetic/one");
  });
  await expectCounts(1, 2);

  await page.evaluate(() => {
    window.__counts.fail = "/synthetic/two";
    window.__counts.notify("local", "/synthetic/two");
  });
  await expectCounts("-", "-");
  assert.equal(await button.getAttribute("aria-description"), "任务数量暂不可用");
  await page.evaluate(() => {
    window.__counts.fail = null;
    window.__counts.notify("local", "/synthetic/two");
  });
  await expectCounts(1, 2);

  // A late snapshot cannot replace the newer event-driven result.
  await page.evaluate(() => {
    window.__counts.defer = "/synthetic/one";
    window.__counts.notify("local", "/synthetic/one");
  });
  await page.waitForFunction(() => window.__counts.pending.length === 1);
  await page.evaluate(() =>
    window.__counts.replace("local", "/synthetic/one", ["running", "done", "review"]),
  );
  await expectCounts(2, 2);
  await page.evaluate(() => window.__counts.finish());
  await expectCounts(2, 2);
  await page.evaluate(() => {
    window.__counts.defer = "/synthetic/two";
    window.__counts.notify("local", "/synthetic/two");
  });
  await page.waitForFunction(() => window.__counts.pending.length === 1);
  await page.evaluate(() => window.__counts.setProjects([{ workspacePath: "/synthetic/one" }]));
  await expectCounts(1, 1);
  assert.equal(
    await page.evaluate(() => window.__counts.listeners.local["/synthetic/two"].size),
    0,
  );
  await page.evaluate(() => window.__counts.finish());
  await expectCounts(1, 1);

  // Same path on separate Hosts must not borrow the active provider or local data.
  await page.evaluate(() =>
    window.__counts.setProjects([
      { workspacePath: "/synthetic/shared" },
      { workspacePath: "/synthetic/shared", workspaceIdentity: "remote-a", remoteSessionId: "A" },
      { workspacePath: "/synthetic/shared", workspaceIdentity: "remote-b", remoteSessionId: "B" },
    ]),
  );
  await expectCounts(2, 3);
  await page.evaluate(() => window.__counts.activateRemote());
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expectCounts(2, 3);
  assert.equal(
    await page.evaluate(() =>
      window.__counts.calls.some((call) => call.host === "A" && !call.workspaceIdentity),
    ),
    false,
    "an active same-path remote tab must not capture the local project query",
  );
  const localReads = await page.evaluate(
    () => window.__counts.calls.filter((c) => c.op === "list" && c.host === "local").length,
  );
  await page.evaluate(() => window.__counts.disconnect("A"));
  await expectCounts("-", "-");
  assert.equal(
    await page.evaluate(
      () => window.__counts.calls.filter((c) => c.op === "list" && c.host === "local").length,
    ),
    localReads,
  );
  assert.equal(await page.evaluate(() => window.__counts.listeners.A["remote-a"].size), 0);
  await page.evaluate(() => window.__counts.connect("A"));
  await expectCounts(2, 3);

  await page.evaluate(() =>
    window.__counts.setProjects([{ workspacePath: "/synthetic/legacy", remoteSessionId: "A" }]),
  );
  await expectCounts(0, 2);
  const legacyLocalReads = await page.evaluate(
    () => window.__counts.calls.filter((c) => c.op === "list" && c.host === "local").length,
  );
  await page.evaluate(() => window.__counts.disconnect("A"));
  await expectCounts("-", "-");
  assert.equal(
    await page.evaluate(
      () => window.__counts.calls.filter((c) => c.op === "list" && c.host === "local").length,
    ),
    legacyLocalReads,
    "a disconnected legacy attachment must never fall back to the local Host",
  );
  await page.evaluate(() => window.__counts.connect("A"));
  await expectCounts(0, 2);

  await page.evaluate(() => window.__counts.setProjects([{ workspacePath: "/synthetic/one" }]));
  await expectCounts(1, 1);
  await page.evaluate(() => window.__counts.unsupported());
  await expectCounts("-", "-");
  assert.equal(await button.getAttribute("aria-description"), "任务数量暂不可用");
  await page.evaluate(() => window.__counts.supported());
  await expectCounts(1, 1);

  await page.evaluate(() => window.__counts.setProjects([]));
  await expectCounts(0, 0);
  assert.equal((await button.innerText()).replace(/\s+/g, ""), "待办任务");
  assert.equal(
    await page.evaluate(() =>
      Object.values(window.__counts.listeners)
        .flatMap((host) => Object.values(host))
        .reduce((n, listeners) => n + listeners.size, 0),
    ),
    0,
  );
  await page.evaluate(() => window.__counts.setProjects([{ workspacePath: "/synthetic/empty" }]));
  await expectCounts(0, 0);
  await page.evaluate(() =>
    window.__counts.replace("local", "/synthetic/empty", ["todo", "queued", "done", "canceled"]),
  );
  await expectCounts(0, 0);
  await page.screenshot({ path: join(artifacts, "zero-counts.png") });
  await page.evaluate(() => window.__counts.replace("local", "/synthetic/empty", ["review"]));
  await expectCounts(0, 1);
  assert.equal((await button.innerText()).replace(/\s+/g, ""), "待办任务1");
  await page.screenshot({ path: join(artifacts, "waiting-only.png") });
  await page.evaluate(() => window.__counts.replace("local", "/synthetic/empty", ["running"]));
  await expectCounts(1, 0);
  assert.equal((await button.innerText()).replace(/\s+/g, ""), "待办任务1");
  await page.screenshot({ path: join(artifacts, "running-only.png") });
  await page.evaluate(() => {
    window.__counts.rows.local["/synthetic/empty"][0].archived = true;
    window.__counts.notify("local", "/synthetic/empty");
  });
  await expectCounts(0, 0);
  assert.equal((await button.innerText()).replace(/\s+/g, ""), "待办任务");
  await page.evaluate(() =>
    window.__counts.replace(
      "local",
      "/synthetic/empty",
      Array.from({ length: 123 }, (_, i) => (i < 45 ? "running" : "awaiting_input")),
    ),
  );
  await expectCounts(45, 78);

  await page.mouse.move(300, 120);
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__counts.setLocale(locale), locale);
    await page.waitForFunction(
      (locale) =>
        document
          .querySelector('[data-testid="work-tasks-sidebar-open"]')
          ?.getAttribute("aria-label") === (locale === "zh-CN" ? "待办任务" : "Work Tasks"),
      locale,
    );
    assert.equal(
      (await button.innerText()).replace(/\s+/g, ""),
      locale === "zh-CN" ? "待办任务4578" : "WorkTasks4578",
    );
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__counts.setTheme(theme), theme);
      for (const width of [1120, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        const geometry = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          // 只比较叶子元素；计数容器本来就包含图标和数字，不能作为相邻元素判断重叠。
          const parts = [
            ...element.querySelectorAll(
              'svg[data-testid], span[data-testid="work-tasks-sidebar-running"], span[data-testid="work-tasks-sidebar-waiting"], span.text-left',
            ),
          ].map((part) => {
            const r = part.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              width: r.width,
              scrollWidth: part.scrollWidth,
              clientWidth: part.clientWidth,
            };
          });
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            bodyWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
            parts,
          };
        });
        assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify(geometry));
        assert.ok(geometry.bodyWidth <= geometry.viewport, JSON.stringify(geometry));
        for (let i = 0; i < geometry.parts.length; i++) {
          const part = geometry.parts[i];
          assert.ok(
            part.width > 0 && part.left >= geometry.left && part.right <= geometry.right,
            JSON.stringify(geometry),
          );
          assert.ok(part.scrollWidth <= part.clientWidth + 1, JSON.stringify(geometry));
          if (i) assert.ok(geometry.parts[i - 1].right <= part.left, JSON.stringify(geometry));
        }
        await page.screenshot({ path: join(artifacts, `${locale}-${theme}-${width}.png`) });
      }
    }
  }
  await page.mouse.move(300, 120);
  await button.blur();
  await button.hover();
  await page.getByRole("tooltip").waitFor();
  assert.match(await page.getByRole("tooltip").innerText(), /45 running, 78 waiting/);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__counts.calls.filter((c) => !["list", "navigate"].includes(c.op)),
    ),
    [],
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: sidebar task counts, zero-count visibility, live updates, stale reads, scope/Host isolation, errors and responsive themes. Screenshots: ${artifacts}`,
  );
} catch (error) {
  console.error(`Screenshots: ${artifacts}`);
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
