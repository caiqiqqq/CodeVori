// pnpm exec tsx packages/ui/test/acpStreamingSnapshots.e2e.mjs
// Real Host persistence and timeline; synthetic adapter, isolated files, no model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { summarizeAcpSession } from "@zcode/shared";
import { createAcpService } from "../../services/src/acp/acpServiceImpl.ts";
import { readPersistedAcpSession } from "../../services/test/acpTestStorage.ts";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-streaming-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const directory = await mkdtemp(join(tmpdir(), "acp-streaming-e2e-"));
let update;
let finish;
let started;
const ready = new Promise((resolve) => {
  started = resolve;
});
const turnEnd = new Promise((resolve) => {
  finish = resolve;
});
const service = createAcpService({
  directory,
  connect: async (input) => {
    update = input.onUpdate;
    return {
      sessionId: "synthetic-streaming",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        started();
        await turnEnd;
      },
      async cancel() {
        finish();
      },
      close() {
        finish();
      },
    };
  },
});
let browser;
try {
  const workspace = { workspacePath: "/synthetic/browser", workspaceIdentity: "browser:stream" };
  const session = await service.create({ ...workspace, agent: "codex" });
  const snapshots = [];
  const subscription = service.onDynamicSessionChanged(workspace)((change) => {
    if (change.kind === "updated") snapshots.push(change);
  });
  const turn = service.prompt({
    ...workspace,
    id: session.id,
    commandId: "browser-turn",
    text: "测试流式输出",
  });
  await ready;
  const initial = await service.read({ ...workspace, id: session.id });
  const conversationEvents = [];
  const conversationSubscription = service.onDynamicConversationChanged({
    ...workspace,
    id: session.id,
    subscriptionId: "captured",
  })((change) => conversationEvents.push(change));
  const initialFrames = await service.readConversation({
    ...workspace,
    id: session.id,
    subscriptionId: "captured",
  });
  const capture = async () => ({
    live: conversationEvents.splice(0),
    snapshot: await service.readConversation({
      ...workspace,
      id: session.id,
      subscriptionId: "captured",
    }),
  });
  await update({ kind: "text", text: "我" });
  const first = snapshots.at(-1);
  const firstFrames = await capture();
  await delay(1050); // 真实采样间隔；不改变生产分片调度。
  const batch = "正在持续输出，第一批文字已完整显示。";
  await Promise.all([...batch].map((text) => update({ kind: "text", text })));
  const live = snapshots.at(-1);
  const liveFrames = await capture();
  const tail = "第二批文字与停止前的尾段也全部保留。";
  await Promise.all([...tail].map((text) => update({ kind: "text", text })));
  finish();
  const completed = await turn;
  const terminal = snapshots.at(-1);
  const terminalFrames = await capture();
  // 历史已使用 checkpoint + journal；回放必须读完整持久事实，不能只读旧 checkpoint。
  const replay = await readPersistedAcpSession(join(directory, `${session.id}.json`));
  assert.deepEqual(replay, completed);
  subscription.dispose();
  assert.ok(first.streamDiagnostics && live.streamDiagnostics && terminal.streamDiagnostics);
  conversationSubscription.dispose();
  const data = {
    initial,
    first,
    live,
    terminal,
    replay,
    initialFrames,
    firstFrames,
    liveFrames,
    terminalFrames,
    summaries: {
      initial: summarizeAcpSession(initial),
      first: summarizeAcpSession(first.session),
      live: summarizeAcpSession(live.session),
      terminal: summarizeAcpSession(terminal.session),
    },
  };
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';

      import {useAcpConversation} from '../../../ui/src/v4/useAcpConversation.ts';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const data=${JSON.stringify(data)};
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      const listeners=new Set(); const bodyListeners=new Map(); let currentSummary=data.summaries.initial; let currentFrames=data.initialFrames;
      const mapped=(change,id)=>{const copy=structuredClone(change);copy.wire.subscriptionId=id;if(copy.wire.kind==='complete')copy.wire.frame.subscriptionId=id;return copy};
      window.__streamLogs=[]; window.__throwSink=false;
      window.zcode={log:(_level,args)=>{if(window.__throwSink)throw new Error('sink unavailable');
        if(args[0]==='[diagnostics]'&&args[1]?.scope==='renderer-acp-stream')window.__streamLogs.push(args[1]);}};
      const service={listSummaries:async()=>[data.summaries.initial],refreshSummary:async()=>currentSummary,
        readConversation:async input=>currentFrames.map(change=>mapped(change,input.subscriptionId)),
        conversationRowsRange:async()=>({rows:[],atSeq:0,atRevision:0,atLogEpoch:'unused',hasMore:false}),
        onDynamicConversationChanged:input=>listener=>{bodyListeners.set(input.subscriptionId,listener);return{dispose(){bodyListeners.delete(input.subscriptionId)}}},
        create:async()=>{throw new Error('unexpected create')},remove:async()=>{},
        onDynamicSessionSummaryChanged:()=>listener=>{listeners.add(listener);return{dispose(){listeners.delete(listener)}}}};
      const emit=(change,frames,summary)=>{currentSummary=summary;currentFrames=frames.snapshot;
        listeners.forEach(listener=>listener({kind:'updated',session:summary}));
        for(const [id,listener] of bodyListeners)frames.live.forEach(change=>listener(mapped(change,id)))};
      function Fixture(){
        const view=useAcpConversation(service as never,{workspacePath:'/synthetic/browser',workspaceIdentity:'browser:stream'},'codex');
        useEffect(()=>view.selectById('codex',data.initial.id),[]);
        const snapshot=view.selected;
        const [epoch,setEpoch]=useState(0);
        window.__stream={first:()=>emit(data.first,data.firstFrames,data.summaries.first),live:()=>emit(data.live,data.liveFrames,data.summaries.live),finish:()=>emit(data.terminal,data.terminalFrames,data.summaries.terminal),
          stale:()=>emit(data.first,data.firstFrames,data.summaries.first),
          failSink:()=>{window.__throwSink=true;const frames=structuredClone(data.terminalFrames);frames.live=frames.snapshot.map(change=>{change.session.revision=data.replay.revision+1;change.wire.deliveryKind='online';change.wire.frame.toSeq=data.replay.revision+1;change.wire.frame.payload.snapshot.seq=data.replay.revision+1;change.wire.frame.payload.snapshot.revision=data.replay.revision+1;return change});emit({...data.terminal,session:{...data.replay,revision:data.replay.revision+1}},frames,{...data.summaries.terminal,revision:data.replay.revision+1})},
          replay:()=>{emit({kind:'updated',session:structuredClone(data.replay)},{...data.terminalFrames,live:[]},data.summaries.terminal);setEpoch(e=>e+1)}};
        const rows=view.rows;
        return <div className="h-screen flex flex-col bg-background text-foreground" data-ready={view.ready}
          data-status={snapshot?.status} data-revision={snapshot?.revision}>
          <ConversationTimeline key={epoch} sessionKey={'stream-'+epoch} rows={rows} totalCount={rows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/browser',
              theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'stream-'+epoch}} />
        </div>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    await page.waitForFunction(() => document.querySelector('[data-ready="true"]'));
    assert.equal(
      await page.evaluate(() => window.__streamLogs.length),
      0,
      "list/refresh must not fabricate live timings",
    );
    await page.evaluate(() => window.__stream.first());
    const assistant = page
      .locator('[data-conversation-selectable="true"]')
      .filter({ hasText: /^我/ });
    await assistant.waitFor();
    assert.equal(await assistant.innerText(), "我");
    await page.waitForFunction(() =>
      window.__streamLogs.some((r) => r.stage === "frame-opportunity"),
    );
    const firstRevision = await page.locator('[data-ready="true"]').getAttribute("data-revision");
    await page.evaluate(() => window.__stream.live());
    await page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('[data-conversation-selectable="true"]')].some(
          (node) => node.textContent === text,
        ),
      "我" + batch,
    );
    assert.equal(await page.locator('[data-ready="true"]').getAttribute("data-status"), "running");
    assert.ok(
      Number(await page.locator('[data-ready="true"]').getAttribute("data-revision")) >
        Number(firstRevision),
    );
    await page.waitForFunction(
      (revision) =>
        window.__streamLogs.some((r) => r.stage === "frame-opportunity" && r.revision === revision),
      live.session.revision,
    );
    await page.evaluate(() => window.__stream.finish());
    await page.waitForFunction(
      () => document.querySelector('[data-ready="true"]')?.getAttribute("data-status") === "idle",
    );
    assert.equal(await assistant.innerText(), "我" + batch + tail);
    await page.waitForFunction(
      (revision) =>
        window.__streamLogs.some((r) => r.stage === "frame-opportunity" && r.revision === revision),
      terminal.session.revision,
    );
    const observed = await page.evaluate(() => window.__streamLogs);
    for (const event of [first, live, terminal]) {
      const stages = observed.filter(
        (r) => r.sessionId === session.id && r.revision === event.session.revision,
      );
      assert.deepEqual(
        stages.map((r) => r.stage),
        ["ui-received", "ui-commit", "frame-opportunity"],
      );
      assert.ok(stages.every((r) => r.facts.receivedAt === event.streamDiagnostics.receivedAt));
    }
    await page.evaluate(() => window.__stream.stale());
    await page.evaluate(() => window.__stream.replay());
    await assistant.waitFor();
    assert.equal(await assistant.innerText(), "我" + batch + tail);
    assert.equal(await assistant.count(), 1, "replay must not duplicate assistant output");
    assert.equal(
      await page.evaluate(() => window.__streamLogs.length),
      observed.length,
      "stale/replay observations must not be treated as live",
    );
    assert.equal(JSON.stringify(observed).includes("测试流式输出"), false);
    assert.equal(JSON.stringify(observed).includes("/synthetic/browser"), false);
    await page.evaluate(() => window.__stream.failSink());
    await page.waitForFunction(
      (revision) =>
        Number(document.querySelector('[data-ready="true"]')?.getAttribute("data-revision")) ===
        revision,
      replay.revision + 1,
    );
    assert.equal(
      await assistant.innerText(),
      "我" + batch + tail,
      "sink failure cannot block accepted text",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.screenshot({ path: join(directory, `stream-${width}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS: Host + real hook/timeline correlated receive/commit/frame, stale/replay and throwing sink at 1280/375px. Screenshots: ${directory}`,
  );
} finally {
  finish();
  await service.disposeAllAndWait();
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
