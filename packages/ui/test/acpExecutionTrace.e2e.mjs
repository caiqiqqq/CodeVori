// Real trace pane, hook, service routing and providers; fake Hosts, no user sessions/model calls.
// ZCODE_E2E_VITE_URL=http://localhost:5174 node packages/ui/test/acpExecutionTrace.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-execution-trace-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "codevori-acp-execution-trace-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN" class="theme-zai-light"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AcpExecutionTracePane} from '../../../ui/src/AcpExecutionTracePane.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
      import {acpSessionSchema} from '@zcode/shared';
      import '../../../ui/src/styles.css';

      const workspacePath='/fixture/acp-trace';
      const firstId=crypto.randomUUID(), secondId=crypto.randomUUID(), remoteId=crypto.randomUUID();
      const calls=[], unexpected=[];
      const event=(kind,timestamp,extra={})=>({eventId:crypto.randomUUID(),kind,timestamp,...extra});
      function makeSession(id,agent,prompt='修复缓存读取',scope={}) {
        return acpSessionSchema.parse({id,agent,acpSessionId:'native:'+id,workspacePath,...scope,title:'Fixture trace',revision:1,status:'idle',pendingPermission:null,error:null,
          usageTurns:[{commandId:'one',inputTokens:7,outputTokens:3,totalTokens:10}],entries:[
            {id:'user:one',kind:'user',text:prompt,createdAt:1700000000000,traceSelections:[{name:'Model',value:'fixture-model'}],attachmentNames:['fixture.png']},
            {id:'tool:one:reuse',kind:'tool',title:'检查缓存',status:'completed',toolKind:'execute',toolName:'shell',input:JSON.stringify({command:'inspect-cache',note:'x'.repeat(400)}),output:'cache result OK',content:'fixture.ts\\nbefore\\n→\\nafter'},
            {id:'assistant:one',kind:'assistant',text:'缓存读取完成'},
            {id:'user:two',kind:'user',text:'验证失败场景',traceError:'fixture-specific-failure'},
            {id:'tool:two:reuse',kind:'tool',title:'执行测试',status:'failed',input:'pnpm test',output:'failed check'},
          ]});
      }
      const initialEvents=()=>[
        event('prompt-accepted',100,{turnIndex:0}),event('tool-update',110,{turnIndex:0,entryIndex:1,status:'in_progress'}),
        event('permission-requested',115,{turnIndex:0,entryIndex:1,requestId:'00000000-0000-4000-8000-000000000001'}),
        event('permission-resolved',116,{turnIndex:0,entryIndex:1,requestId:'00000000-0000-4000-8000-000000000001',permissionDecision:'allow_once'}),
        event('tool-update',120,{turnIndex:0,entryIndex:1,status:'completed'}),event('turn-completed',130,{turnIndex:0,stopReason:'end_turn'}),
        event('prompt-accepted',200,{turnIndex:3}),event('turn-interrupted',220,{turnIndex:3}),event('tool-update',1,{status:'completed'})];
      function host(scope={}) {
        const sessions=new Map(), traces=new Map(), sessionListeners=new Set(), traceListeners=new Set(), holds=new Set(), releases=[];
        const key=scope.workspaceIdentity||workspacePath;
        const check=(target)=>{if(target.workspacePath!==workspacePath||(target.workspaceIdentity?.trim()||target.workspacePath)!==key) throw new Error('Wrong Host scope')};
        const wait=async(id)=>{if(holds.has(id)) await new Promise(resolve=>releases.push({id,resolve}))};
        const forbidden=()=>{unexpected.push('Agent command');throw new Error('Read-only trace must not invoke an Agent')};
        const subscribe=(set,kind)=>target=>listener=>{check(target);calls.push({kind,key});set.add(listener);return {dispose:()=>set.delete(listener)}};
        const services={acpService:{
          read:async target=>{check(target);calls.push({kind:'read',key,id:target.id});const captured=structuredClone(sessions.get(target.id));await wait(target.id);if(!captured) throw new Error('Missing');return captured},
          getExecutionTrace:async target=>{check(target);calls.push({kind:'trace',key,id:target.id});const captured=structuredClone(traces.get(target.id)||[]);await wait(target.id);return captured},
          onDynamicSessionChanged:subscribe(sessionListeners,'subscribe-session'),onDynamicExecutionTraceChanged:subscribe(traceListeners,'subscribe-trace'),
          create:forbidden,refresh:forbidden,prompt:forbidden,authenticate:forbidden,
        }};
        const publish=(id)=>{const session=sessions.get(id);for(const listener of sessionListeners) listener({kind:'updated',session:structuredClone(session)})};
        const publishEvent=(id,value)=>{traces.set(id,[...(traces.get(id)||[]),value]);for(const listener of traceListeners) listener({...scope,workspacePath,id,event:value})};
        return {services,sessions,traces,sessionListeners,traceListeners,holds,releases,publish,publishEvent,
          release(id){holds.delete(id);for(const item of releases.splice(0)) item.resolve()},
          append(id,text='实时提问') {const session=sessions.get(id),turnIndex=session.entries.length;
            sessions.set(id,{...session,revision:session.revision+1,status:'running',entries:[...session.entries,{id:'user:live'+turnIndex,kind:'user',text},
              {id:'tool:live'+turnIndex,kind:'tool',title:'实时工具',status:'in_progress',input:'live parameter'}]});publish(id);
            const accepted=event('prompt-accepted',300+turnIndex,{turnIndex});publishEvent(id,accepted);publishEvent(id,accepted);
            publishEvent(id,event('tool-update',310+turnIndex,{turnIndex,entryIndex:turnIndex+1,status:'in_progress'}));return turnIndex},
          complete(id) {const session=sessions.get(id),entryIndex=session.entries.length-1,turnIndex=entryIndex-1;
            sessions.set(id,{...session,revision:session.revision+1,status:'idle',entries:[...session.entries.slice(0,-1),{...session.entries.at(-1),status:'completed',output:'live output'},
              {id:'assistant:live',kind:'assistant',text:'实时回复'}]});publish(id);
            publishEvent(id,event('tool-update',340+turnIndex,{turnIndex,entryIndex,status:'completed'}));publishEvent(id,event('turn-completed',350+turnIndex,{turnIndex,stopReason:'end_turn'}))},
          remove(id) {sessions.delete(id);for(const listener of sessionListeners) listener({kind:'removed',id,workspaceKey:key,workspacePath})},
        };
      }
      const local=host(), scope={workspaceIdentity:'fixture:remote',remoteSessionId:'remote-fixture'}, remote=host(scope);
      local.sessions.set(firstId,makeSession(firstId,'codex'));local.traces.set(firstId,initialEvents());local.holds.add(firstId);
      local.sessions.set(secondId,makeSession(secondId,'claude','SECOND SESSION'));local.traces.set(secondId,initialEvents());
      remote.sessions.set(remoteId,makeSession(remoteId,'gemini','REMOTE SESSION',scope));remote.traces.set(remoteId,initialEvents());
      const controls={calls,unexpected,local,remote,firstId,secondId,remoteId,closed:0};window.__acpTrace=controls;
      function Fixture() {
        const [target,setTarget]=useState({sessionId:firstId,workspacePath});const [visible,setVisible]=useState(true);
        controls.open=id=>{setVisible(true);setTarget({sessionId:id,workspacePath})};
        controls.openRemote=()=>{useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:scope.remoteSessionId,services:remote.services});
          setVisible(true);setTarget({sessionId:remoteId,workspacePath,...scope})};
        controls.disconnect=()=>useRemoteWorkspaceSessionStore.getState().unregisterSession(scope.remoteSessionId);
        controls.reconnect=()=>useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:scope.remoteSessionId,services:{...remote.services,acpService:{...remote.services.acpService}}});
        return <main className="bg-background text-foreground" style={{height:'calc(100vh - 24px)',margin:12,width:'calc(100vw - 24px)',maxWidth:700}}>
          {visible?<AcpExecutionTracePane {...target} onClose={()=>{controls.closed++;setVisible(false)}}/>:null}
        </main>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false} as never}>
        <TabStoreProvider><ServiceProvider services={local.services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
      </PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${name}.html`);
  const pane = page.getByTestId("acp-execution-trace");
  const turns = pane.locator("[data-acp-trace-turn]");
  const search = pane.getByRole("textbox", { name: "搜索提问、回复、工具参数与结果…" });
  const count = async (expected) =>
    page.waitForFunction(
      (expected) => document.querySelectorAll("[data-acp-trace-turn]").length === expected,
      expected,
    );
  const shown = async (text) => pane.getByText(text, { exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(
    () => window.__acpTrace?.calls.filter((call) => call.kind === "read").length === 1,
  );
  assert.deepEqual(
    await page.evaluate(() => window.__acpTrace.calls.slice(0, 4).map((call) => call.kind)),
    ["subscribe-session", "subscribe-trace", "read", "trace"],
  );
  // The initial RPC captured revision 1, but revision 2/stream facts reach the pane first.
  await page.evaluate(() => window.__acpTrace.local.append(window.__acpTrace.firstId));
  await count(3);
  await shown("实时提问");
  await page.evaluate(() => window.__acpTrace.local.release(window.__acpTrace.firstId));
  await shown("自动更新");
  await count(3);
  await page.evaluate(() => window.__acpTrace.local.complete(window.__acpTrace.firstId));
  await pane.getByRole("button", { name: "全部收起" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="acp-execution-trace"] details')].every(
      (element) => !element.open,
    ),
  );
  await pane.getByRole("button", { name: "全部展开" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="acp-execution-trace"] details')].every(
      (element) => element.open,
    ),
  );
  await shown("cache result OK");
  await shown("live output");
  await shown("fixture.ts\nbefore\n→\nafter");
  assert.ok((await pane.innerText()).includes("输入 7 · 输出 3 · 总计 10 Token"));
  // Each persisted/live event ID appears only once in its own lifecycle list.
  const liveLifecycle = turns
    .last()
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "事件记录" }) })
    .last();
  assert.equal(await liveLifecycle.getByText("已接收提问", { exact: true }).count(), 1);
  await page.screenshot({ path: join(artifacts, "wide-light.png") });

  await search.fill("inspect-cache");
  await count(1);
  await search.fill("实时回复");
  await count(1);
  await search.fill("");
  await count(3);
  await pane.getByRole("checkbox").click();
  await count(1);
  await shown("fixture-specific-failure");
  await pane.getByRole("checkbox").click();
  await count(3);
  // Stale RPC from B must not rehydrate B after switching back to A.
  await page.evaluate(() => {
    const c = window.__acpTrace;
    c.local.holds.add(c.secondId);
    c.open(c.secondId);
  });
  await page.waitForFunction(() =>
    window.__acpTrace.calls.some(
      (call) => call.kind === "read" && call.id === window.__acpTrace.secondId,
    ),
  );
  await page.evaluate(() => {
    const c = window.__acpTrace;
    c.open(c.firstId);
    c.local.release(c.secondId);
  });
  await count(3);
  await shown("修复缓存读取");
  assert.equal(await pane.getByText("SECOND SESSION", { exact: true }).count(), 0);
  await pane.getByRole("button", { name: "刷新轨迹" }).click();
  await shown("自动更新");
  await count(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.className = "theme-zai-dark"));
  await pane.getByRole("button", { name: "全部收起" }).click();
  await pane.getByRole("button", { name: "全部展开" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="acp-execution-trace"] details')].every(
      (element) => element.open,
    ),
  );
  assert.equal(
    await pane.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: join(artifacts, "narrow-dark.png") });
  await page.evaluate(() => {
    const c = window.__acpTrace;
    c.local.holds.add(c.secondId);
    c.open(c.secondId);
  });
  await page.waitForFunction(
    () =>
      window.__acpTrace.calls.filter(
        (call) => call.kind === "read" && call.id === window.__acpTrace.secondId,
      ).length >= 2,
  );
  await page.evaluate(() => {
    const c = window.__acpTrace;
    c.local.remove(c.secondId);
    c.local.release(c.secondId);
  });
  await count(0);
  await pane.getByRole("alert").waitFor();
  assert.equal(await pane.getByText("SECOND SESSION", { exact: true }).count(), 0);
  await page.evaluate(() => window.__acpTrace.openRemote());
  await count(2);
  await shown("REMOTE SESSION");
  assert.equal(await pane.locator('[data-acp-agent-icon="gemini"]').count(), 1);
  const localReads = await page.evaluate(
    () =>
      window.__acpTrace.calls.filter(
        (call) => call.kind === "read" && call.key === "/fixture/acp-trace",
      ).length,
  );
  await page.evaluate(() => window.__acpTrace.disconnect());
  await pane.getByRole("alert").waitFor();
  await page.evaluate(() => {
    const c = window.__acpTrace;
    c.remote.append(c.remoteId, "重连后回放");
    c.reconnect();
  });
  await count(3);
  await shown("重连后回放");
  assert.equal(
    await page.evaluate(
      () =>
        window.__acpTrace.calls.filter(
          (call) => call.kind === "read" && call.key === "/fixture/acp-trace",
        ).length,
    ),
    localReads,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__acpTrace.local.sessionListeners.size + window.__acpTrace.local.traceListeners.size,
    ),
    0,
  );
  await page.evaluate(() => window.__acpTrace.remote.remove(window.__acpTrace.remoteId));
  await count(0);
  await pane.getByRole("alert").waitFor();
  await pane.getByRole("button", { name: "关闭 ACP 执行轨迹" }).click();
  await pane.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.__acpTrace.unexpected), []);
  assert.equal(await page.evaluate(() => window.__acpTrace.closed), 1);
  assert.equal(
    await page.evaluate(
      () =>
        window.__acpTrace.remote.sessionListeners.size +
        window.__acpTrace.remote.traceListeners.size,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    `ACP trace E2E passed: details, filters, live dedup, stale reads, narrow/dark, remote reconnect, deletion and cleanup; artifacts=${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
