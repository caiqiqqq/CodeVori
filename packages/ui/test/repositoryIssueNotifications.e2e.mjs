// Isolated notification port: exercises production polling/hooks without OS or Forge side effects.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__issue-notifications-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-issue-notifications-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {useRepositoryIssueSources} from '../../../ui/src/hooks/useRepositoryIssueCounts.ts';
    import {useRepositoryIssueNotifications} from '../../../ui/src/hooks/useRepositoryIssueNotifications.ts';
    import {RepositorySidebarButton} from '../../../ui/src/repository-panel/RepositorySidebarButton.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {repositoryNavigationStore} from '../../../ui/src/store/repositoryNavigationStore.ts';
    const project={workspacePath:'/synthetic/project'};
    const remote={...project,workspaceIdentity:'synthetic-endpoint-b',remoteSessionId:'attachment-b'};
    const state:any={calls:[],sent:[],opened:[],listeners:{A:new Set(),B:new Set()},clicks:new Set(),issues:{A:[],B:[]},fail:false,delay:false,pending:[],count:3};
    const issue=(number:number,repositoryKey='repo-A')=>({...project,repositoryKey,repositoryName:repositoryKey,number,title:'Synthetic issue '+number,url:'https://forge.example.invalid/issues/'+number});
    state.issue=issue;
    const platform:any={showTaskNotification:payload=>state.sent.push(payload),openExternal:url=>state.opened.push(url),onTaskNotificationClick:callback=>{state.clicks.add(callback);return()=>state.clicks.delete(callback)}};
    const hosts:any={};
    for(const host of ['A','B']) hosts[host]={workTaskService:{
      async getRepositoryIssueSummary(input:any){
        state.calls.push({host,...input});
        const data={pending:state.count,checkedAt:Date.now(),newIssues:[...state.issues[host]]};
        if(state.delay){state.delay=false;await new Promise(resolve=>state.pending.push(resolve))}
        if(state.fail)throw new Error('FORGE_NETWORK');
        return data;
      },
      onDynamicChanged:()=>listener=>{state.listeners[host].add(listener);return{dispose:()=>state.listeners[host].delete(listener)}}
    }};
    state.refresh=(host='A')=>{for(const listener of state.listeners[host])listener()};
    state.add=(number:number,host='A')=>{state.issues[host].push(issue(number,'repo-'+host));state.refresh(host)};
    window.__notifications=state;
    function Observer({projects,enabled}:any){
      const sources=useRepositoryIssueSources(projects);
      const {intl}=useZCodeIntl();
      useRepositoryIssueNotifications({sources,enabled,platform,formatMessage:intl.formatMessage});
      return null;
    }
    function Fixture(){
      const [enabled,setEnabled]=useState(true);
      const [mounted,setMounted]=useState(true);
      const [sidebar,setSidebar]=useState(true);
      const [projects,setProjects]=useState<any[]>([project]);
      const {setLocale}=useZCodeIntl();
      return <main>
        {mounted?<Observer projects={projects} enabled={enabled}/>:null}
        {sidebar?<RepositorySidebarButton projects={projects}/>:null}
        <button onClick={()=>setEnabled(value=>!value)}>toggle notifications</button>
        <button onClick={()=>setSidebar(false)}>hide sidebar</button>
        <button onClick={()=>setMounted(value=>!value)}>toggle observer</button>
        <button onClick={()=>setLocale('en-US')}>English</button>
        <button onClick={()=>repositoryNavigationStore.getState().selectRemote(project,'private')}>remote name</button>
        <button onClick={()=>{useRemoteWorkspaceSessionStore.setState({sessionsById:{'attachment-b':{services:hosts.B}},sessionIdByWorkspaceIdentity:{'synthetic-endpoint-b':'attachment-b'}} as any);setProjects([remote])}}>switch host</button>
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<ServiceProvider services={hosts.A}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.clock.install({ time: new Date("2026-10-29T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-29T00:00:01Z"));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
  const waitCalls = (expected) =>
    page.waitForFunction((n) => window.__notifications?.calls.length >= n, expected);
  const sent = () => page.evaluate(() => window.__notifications.sent);
  const settle = () => page.clock.runFor(30);
  await waitCalls(1);
  await settle();
  assert.equal(
    await page.evaluate(() => window.__notifications.calls.length),
    1,
    "badge and observer share one read",
  );
  assert.equal((await sent()).length, 0, "existing issues establish baseline");
  await page.evaluate(() => {
    window.__notifications.count++;
    window.__notifications.refresh();
  });
  await waitCalls(2);
  await settle();
  assert.equal((await sent()).length, 0, "unlink/count increase is not new issue evidence");
  await page.evaluate(() => window.__notifications.add(4));
  await page.waitForFunction(() => window.__notifications.sent.length === 1);
  assert.equal((await sent())[0].title, "新增仓库议题");
  assert.equal((await sent())[0].status, "repository_issue");
  assert.match((await sent())[0].body, /repo-A #4: Synthetic issue 4/);
  await page.evaluate(() => {
    const s = window.__notifications;
    s.refresh();
    for (const listener of s.clicks) listener(s.sent[0].taskId);
  });
  await settle();
  assert.equal((await sent()).length, 1);
  assert.deepEqual(await page.evaluate(() => window.__notifications.opened), [
    "https://forge.example.invalid/issues/4",
  ]);
  await page.getByRole("button", { name: "toggle notifications", exact: true }).click();
  await page.evaluate(() => window.__notifications.add(5));
  await settle();
  assert.equal((await sent()).length, 1);
  await page.getByRole("button", { name: "toggle notifications", exact: true }).click();
  await page.evaluate(() => window.__notifications.refresh());
  await settle();
  assert.equal((await sent()).length, 1, "enabling does not replay disabled-period facts");
  await page.getByRole("button", { name: "hide sidebar", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.__notifications.issues.A.push(window.__notifications.issue(6));
  });
  await page.clock.runFor(60_000);
  await page.waitForFunction(() => window.__notifications.sent.length === 2);
  assert.equal((await sent())[1].title, "New repository issue");
  await page.evaluate(() => {
    window.__notifications.fail = true;
    window.__notifications.add(7);
  });
  await settle();
  assert.equal((await sent()).length, 2);
  await page.evaluate(() => {
    window.__notifications.fail = false;
    window.__notifications.refresh();
  });
  await page.waitForFunction(() => window.__notifications.sent.length === 3);
  await page.evaluate(() => {
    window.__notifications.delay = true;
    window.__notifications.add(8);
  });
  await settle();
  await page.getByRole("button", { name: "remote name", exact: true }).click();
  await page.waitForFunction(
    () => window.__notifications.calls.at(-1).projects[0].remoteName === "private",
  );
  await settle();
  await page.evaluate(() => window.__notifications.pending.shift()());
  await settle();
  assert.equal((await sent()).length, 3, "late old scope response is discarded");
  await page.getByRole("button", { name: "switch host", exact: true }).click();
  await page.waitForFunction(() => window.__notifications.calls.at(-1).host === "B");
  await settle();
  await page.evaluate(() => window.__notifications.add(9, "B"));
  await page.waitForFunction(() => window.__notifications.sent.length === 4);
  assert.match((await sent())[3].body, /repo-B #9/);
  await page.evaluate(() => {
    const s = window.__notifications;
    for (const listener of s.clicks) listener(s.sent[0].taskId);
  });
  assert.equal(
    await page.evaluate(() => window.__notifications.opened.at(-1)),
    "https://forge.example.invalid/issues/4",
    "original notification remains clickable after Host switch",
  );
  assert.equal(
    await page.evaluate(() => window.__notifications.calls.at(-1).projects[0].workspaceIdentity),
    "synthetic-endpoint-b",
  );
  assert.equal(
    await page.evaluate(() => window.__notifications.calls.at(-1).projects[0].remoteSessionId),
    "attachment-b",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "toggle observer", exact: true }).click();
  const finalCalls = await page.evaluate(() => window.__notifications.calls.length);
  await page.clock.runFor(120_000);
  assert.equal(await page.evaluate(() => window.__notifications.calls.length), finalCalls);
  assert.equal(await page.evaluate(() => window.__notifications.clicks.size), 0);
  assert.equal(
    await page.evaluate(
      () => window.__notifications.listeners.A.size + window.__notifications.listeners.B.size,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", artifacts, notifications: 4 }));
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
