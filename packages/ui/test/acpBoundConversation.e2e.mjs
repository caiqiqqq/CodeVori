// Run with desktop Vite: node packages/ui/test/acpBoundConversation.e2e.mjs
// Real hook/projection/composer controls; synthetic Host, no user data or Agent calls.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-bound-conversation-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {acpSessionSchema, summarizeAcpSession} from '@zcode/shared';
    import {useAcpConversation} from '../../../ui/src/v4/useAcpConversation.ts';
    import {withAcpProjectionFixture} from '../../../ui/test/acpProjectionFixture.tsx';
    import {useAcpComposerConfigPreview} from '../../../ui/src/v4/composer/useAcpComposerConfigPreview.ts';
    import {AcpComposerConfigControls} from '../../../ui/src/v4/composer/AcpComposerConfigControls.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    const scope = {workspacePath:'/fixture/work-task', workspaceIdentity:'host:one', remoteSessionId:'attachment:one'};
    const sessions = new Map(['A','B','failed-refresh'].map(id => [id, acpSessionSchema.parse({
      ...scope, id, agent:'codex', acpSessionId:'native-'+id, title:id, revision:1,
      status:'idle', entries:[{id:'user:'+id,kind:'user',text:'历史 '+id}],
      pendingPermission:null,error:null
    })]));
    const listeners = new Set(), calls = [], pending = new Map();
    const controls = {calls, pending, delayRead:null, delayList:true, delayRefresh:'A', failList:false};
    window.__bound = controls;
    const service = {
      list:async()=>{throw new Error('Ordinary list must never expose work-task sessions')},
      onDynamicSessionChanged:target=>listener=>{
        const entry={target,listener}; listeners.add(entry);
        return {dispose:()=>listeners.delete(entry)};
      },
      read:async target=>{
        calls.push(['read', target.id, target.workspaceIdentity, target.remoteSessionId]);
        if(controls.delayRead===target.id) await new Promise(resolve=>pending.set('read:'+target.id,resolve));
        const session=sessions.get(target.id);
        if(!session) throw new Error('Bound conversation not found');
        return {...session, ...target};
      },
      refreshSummary:async target=>{
        calls.push(['refresh',target.id,target.workspaceIdentity,target.remoteSessionId]);
        if(controls.delayRefresh===target.id) await new Promise(resolve=>pending.set('refresh:'+target.id,resolve));
        if(target.id==='failed-refresh') throw new Error('Agent connection failed');
        return summarizeAcpSession({...sessions.get(target.id),...target});
      },
      sendConversationCommand:async input=>{
        calls.push(['send',input.id,input.workspaceIdentity,input.remoteSessionId]);
        return {...scope,id:input.id,commandId:input.commandId,
          ack:{commandId:input.commandId,status:'accepted',revisionAtDecision:2},
          disposition:'started',sessionStatus:'running'};
      },
      setConfigOption:async input=>{calls.push(['config',input.id,input.workspaceIdentity,input.remoteSessionId])},
      create:async()=>{calls.push(['create']);throw new Error('Must not replace a bound conversation')},
      remove:async()=>{calls.push(['remove']);throw new Error('Must preserve bound history')},
    };
    withAcpProjectionFixture(service as never);
    const readConversation=service.readConversation;
    service.readConversation=input=>{
      calls.push(['conversation',input.id,input.workspaceIdentity,input.remoteSessionId]);
      return readConversation(input);
    };
    // 模拟普通列表排除待办/委派归属；精确正文订阅仍保留访问和实时更新。
    service.listSummaries=async()=>{
      if(controls.delayList) await new Promise(resolve=>pending.set('list',resolve));
      if(controls.failList) throw new Error('Directory unavailable');
      return [];
    };
    service.onDynamicSessionSummaryChanged=()=>()=>({dispose(){}});
    controls.release=key=>{pending.get(key)?.();pending.delete(key)};
    controls.emit=id=>{
      const session=sessions.get(id);session.revision++;
      session.entries.push({id:'assistant:'+session.revision,kind:'assistant',text:'实时 '+id});
      for(const {target,listener} of listeners) listener({kind:'updated',session:{...session,...target}});
    };
    function Fixture(){
      const [agent,setAgent]=useState(null), [target,setTarget]=useState(scope);
      const view=useAcpConversation(service as never,target,agent);
      const config=useAcpComposerConfigPreview({agent,...target,session:view.selected,ready:view.ready,error:view.error});
      controls.reconnect=()=>setTarget({...scope,remoteSessionId:'attachment:two'});
      controls.switchHost=()=>{setAgent(null);setTarget({...scope,workspaceIdentity:'host:two',remoteSessionId:'attachment:other'})};
      controls.reloadList=view.retryList;
      controls.send=()=>view.send({text:'继续',attachments:[],workspaceFiles:[]});
      controls.setConfig=()=>view.setConfigOption('mode','default');
      const open=id=>{view.selectById('codex',id);setAgent('codex')};
      return <main>
        {['A','B','missing','failed-refresh'].map(id=><button key={id} onClick={()=>open(id)}>打开 {id}</button>)}
        <button onClick={view.retryConnection}>重试</button>
        <div data-testid="state" data-id={view.selected?.id??''} data-ready={view.ready&&!view.busy}
          data-loaded={view.loaded} data-identity={view.selected?.workspaceIdentity??''} data-error={view.error??''}/>
        <pre data-testid="history">{JSON.stringify(view.rows)}</pre>
        {view.error&&<p role="alert">{view.error}</p>}
        <AcpComposerConfigControls options={config.options} modes={config.modes} loading={config.loading}
          disabled={!view.ready||view.busy} onChange={()=>{}}/>
      </main>;
    }
    function Shell(){
      const [epoch,setEpoch]=useState(0);
      controls.remount=()=>setEpoch(value=>value+1);
      return <Fixture key={epoch}/>;
    }
    createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Shell/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174"}/${name}.html`);
    const state = page.getByTestId("state");
    const open = (id) => page.getByRole("button", { name: `打开 ${id}`, exact: true }).click();
    const ready = (id) =>
      page.waitForFunction((id) => {
        const state = document.querySelector('[data-testid="state"]');
        return state?.dataset.id === id && state.dataset.ready === "true";
      }, id);

    // 精确会话的连接就绪也不能等待普通目录：API 会话按自己的投影就绪，
    // ACP 在 Host refreshSummary 确认后同样应允许当前会话操作。
    await open("A");
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="history"]')?.textContent.includes("历史 A"),
    );
    assert.equal(await state.getAttribute("data-loaded"), "false");
    await page.waitForFunction(() => window.__bound.pending.has("refresh:A"));
    await page.evaluate(() => window.__bound.release("refresh:A"));
    await ready("A");
    assert.equal(await state.getAttribute("data-loaded"), "false");
    assert.equal(await page.getByLabel("正在读取智能体选项…", { exact: true }).count(), 0);
    await page.evaluate(async () => {
      await window.__bound.send();
      await window.__bound.setConfig();
    });
    assert.deepEqual(
      await page.evaluate(() =>
        window.__bound.calls
          .filter(([op]) => op === "send" || op === "config")
          .map(([op, id]) => [op, id]),
      ),
      [
        ["send", "A"],
        ["config", "A"],
      ],
    );
    await page.evaluate(() => {
      window.__bound.delayList = false;
      window.__bound.release("list");
    });
    assert.match(await page.getByTestId("history").innerText(), /历史 A/);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.loaded === "true",
    );
    await page.evaluate(() => window.__bound.reloadList());
    await page.waitForFunction(() => window.__bound.pending.has("refresh:A"));
    assert.match(await page.getByTestId("history").innerText(), /历史 A/);
    await page.evaluate(() => window.__bound.release("refresh:A"));
    await ready("A");
    // 列表单独失败不能覆盖已通过精确正文和 Host 连接确认的当前会话。
    await page.evaluate(() => {
      window.__bound.delayRefresh = null;
      window.__bound.delayList = true;
      window.__bound.failList = true;
      window.__bound.reloadList();
    });
    await page.waitForFunction(() => window.__bound.pending.has("list"));
    await ready("A");
    await page.evaluate(() => window.__bound.release("list"));
    await page.waitForTimeout(50);
    assert.equal(await state.getAttribute("data-error"), "");
    assert.equal(await state.getAttribute("data-ready"), "true");
    await page.evaluate(() => {
      window.__bound.failList = false;
      window.__bound.delayList = false;
      window.__bound.reloadList();
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.loaded === "true",
    );
    await page.evaluate(() => window.__bound.emit("A"));
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="history"]')?.textContent.includes("实时 A"),
    );
    // 重新打开面板复用保温正文时，必须同时恢复同 revision 的 Host 元数据。
    await page.evaluate(() => {
      window.__bound.delayRefresh = null;
      window.__bound.remount();
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.id === "",
    );
    await open("A");
    await ready("A");
    assert.match(await page.getByTestId("history").innerText(), /实时 A/);

    // 同 Agent 切换期间迟到读取不能还原旧正文；不能创建替代会话。
    await page.evaluate(() => {
      window.__bound.delayRead = "B";
    });
    await open("B");
    await page.waitForFunction(() => window.__bound.pending.has("read:B"));
    await open("A");
    await page.evaluate(() => {
      window.__bound.delayRead = null;
      window.__bound.delayRefresh = null;
      window.__bound.release("read:B");
      window.__bound.release("refresh:A");
    });
    await ready("A");
    assert.doesNotMatch(await page.getByTestId("history").innerText(), /历史 B/);
    await open("B");
    await ready("B");
    // A 的旧连接跨 B 切回后才完成时，不能继续占住新 A 的输入门禁。
    await page.evaluate(() => {
      window.__bound.delayRefresh = "A";
    });
    await open("A");
    await page.waitForFunction(() => window.__bound.pending.has("refresh:A"));
    await page.evaluate(() => {
      window.__bound.staleRefreshA = window.__bound.pending.get("refresh:A");
      window.__bound.pending.delete("refresh:A");
    });
    await open("B");
    await ready("B");
    await open("A");
    await page.waitForFunction(() => window.__bound.pending.has("refresh:A"));
    await page.evaluate(() => window.__bound.release("refresh:A"));
    await ready("A");
    await page.evaluate(() => {
      window.__bound.staleRefreshA();
      window.__bound.delayRefresh = null;
    });
    assert.equal(await state.getAttribute("data-ready"), "true");
    await open("B");
    await ready("B");
    await page.evaluate(() => window.__bound.reconnect());
    await page.waitForFunction(() =>
      window.__bound.calls.some(
        ([op, id, , attachment]) =>
          op === "conversation" && id === "B" && attachment === "attachment:two",
      ),
    );
    await ready("B");
    await page.evaluate(() => window.__bound.switchHost());
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.id === "",
    );
    await open("B");
    await ready("B");
    assert.equal(await state.getAttribute("data-identity"), "host:two");

    // 精确读取和连接失败必须显示错误，停止无限配置加载，历史不依赖连接成功。
    await open("missing");
    await page.getByRole("alert").filter({ hasText: "Bound conversation not found" }).waitFor();
    assert.equal(await page.getByLabel("正在读取智能体选项…", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__bound.calls.filter(([op, id]) => op === "read" && id === "missing").length === 2,
    );
    await page.evaluate(() => {
      window.__bound.delayList = true;
      window.__bound.reloadList();
    });
    await open("failed-refresh");
    await page.getByRole("alert").filter({ hasText: "Agent connection failed" }).waitFor();
    assert.equal(await state.getAttribute("data-loaded"), "false");
    assert.match(await page.getByTestId("history").innerText(), /历史 failed-refresh/);
    assert.equal(await page.getByLabel("正在读取智能体选项…", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__bound.calls.filter(([op, id]) => op === "refresh" && id === "failed-refresh")
          .length === 2,
    );
    assert.equal(await state.getAttribute("data-loaded"), "false");
    await page.evaluate(() => {
      window.__bound.delayList = false;
      window.__bound.release("list");
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]')?.dataset.loaded === "true",
    );
    assert.match(await state.getAttribute("data-error"), /Agent connection failed/);
    assert.equal(
      await page.evaluate(() =>
        window.__bound.calls.some(([op]) => op === "create" || op === "remove"),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: hidden bound ACP history, delayed list/restore, live projection, stale selection, attachment/Host isolation, explicit read/connect errors and retry (1280/375px).\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
