// Real split SessionPanes and shared composer; synthetic Host only.
import assert from "node:assert/strict";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__split-queue-${process.pid}`;
const html = join(root, name + ".html"),
  moduleFile = join(root, name + ".tsx");
const artifacts = await mkdtemp(join(tmpdir(), "zcode-split-queue-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `      import React, {useState} from 'react';
      import {ChannelClient, ChannelServer, ProxyChannel, createQueuePair} from '@zcode/rpc';
      import {createRoot} from 'react-dom/client';
      import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
      import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider,withAcpProjectionFixture} from '../../../ui/test/acpProjectionFixture.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
const workspacePath='/synthetic/queue-split';const remoteSessionId=new URLSearchParams(location.search).get('delivery')==='replayable'?'fixture-attachment':undefined;
const listeners=new Set();const events=[];let heldPrompt=null;let holdA=false;let finishCreate;let dropNextAcceptance=false;let heldDelete=null;let holdDelete=false;
const item=(id,text)=>({commandId:id,text,attachments:[],workspaceFiles:[],state:'queued',createdAt:Date.now()});
const make=(id)=>({id,agent:'codex',workspacePath,remoteSessionId,acpSessionId:'native-'+id,title:'Conversation '+id,revision:1,status:'running',entries:[{id:'user:first-'+id,kind:'user',text:'First '+id}],configOptions:[],modeState:null,contextUsage:null,usageTurns:[],goal:null,pendingPermission:null,error:null,queue:{items:[item('q-'+id,'queued only in '+id)],autoDrain:true}});
const snapshots=Object.fromEntries(['A','B','C'].map(id=>[id,make(id)]));
const copy=id=>structuredClone(snapshots[id]);
const publish=id=>{snapshots[id].revision++;for(const listener of listeners)listener({kind:'updated',session:copy(id)});return copy(id)};
const requireItem=(id,q)=>{const row=snapshots[id].queue.items.find(row=>row.commandId===q);if(!row||row.state!=='queued')throw Error('missing');return row};
const hostService={create:async()=>{const session=make('new');session.provisional=true;session.status='idle';session.entries=[];session.queue.items=[];snapshots.new=session;await new Promise(resolve=>finishCreate=resolve);return copy('new')},
list:async()=>Object.keys(snapshots).map(copy),read:async({id})=>copy(id),refresh:async({id})=>copy(id),
listAvailableAgents:async()=>[{agent:'codex',available:true,enabled:true,ready:true}],listAgentConfigs:async()=>[],listPlugins:async()=>[],
onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
prompt:async()=>{throw Error('composer must not wait for whole-turn prompt')},
submitPrompt:async input=>{events.push({op:'prompt',id:input.id,text:input.text});if(holdA&&input.id==='A'){holdA=false;await new Promise(resolve=>heldPrompt=resolve);}snapshots[input.id].queue.items.push(item(input.commandId,input.text));if(dropNextAcceptance){dropNextAcceptance=false;snapshots[input.id].revision++;return copy(input.id)}return publish(input.id)},
editQueueItem:async({id,queueItemId,text})=>{requireItem(id,queueItemId).text=text;return publish(id)},
deleteQueueItem:async({id,queueItemId})=>{if(holdDelete){holdDelete=false;await new Promise(resolve=>heldDelete=resolve)}requireItem(id,queueItemId);(snapshots[id].queue.discardedCommandIds??=[]).push(queueItemId);snapshots[id].queue.items=snapshots[id].queue.items.filter(row=>row.commandId!==queueItemId);events.push({op:'delete',id,queueItemId});return publish(id)},
reorderQueueItem:async({id,queueItemId,beforeQueueItemId})=>{const row=requireItem(id,queueItemId);const rows=snapshots[id].queue.items.filter(r=>r!==row);rows.splice(beforeQueueItemId?rows.findIndex(r=>r.commandId===beforeQueueItemId):rows.length,0,row);snapshots[id].queue.items=rows;return publish(id)},
sendQueuedNow:async({id,queueItemId})=>{const row=requireItem(id,queueItemId);snapshots[id].queue.items=snapshots[id].queue.items.filter(r=>r!==row);return publish(id)},
setQueueAutoDrain:async({id,autoDrain})=>{snapshots[id].queue.autoDrain=autoDrain;return publish(id)},stop:async({id})=>{snapshots[id].status='idle';snapshots[id].queue.autoDrain=false;return publish(id)},remove:async()=>{},
};
const [clientProtocol,serverProtocol]=createQueuePair();
// 合成 Host 在 RPC 注册前适配新契约；客户端 Proxy 的方法存在性不代表远端支持。
const server=new ChannelServer(serverProtocol,'fixture');server.registerChannel('acp',ProxyChannel.fromService(withAcpProjectionFixture(hostService)));
const client=new ChannelClient(clientProtocol);const acpService=ProxyChannel.toService(client.getChannel('acp'));
const forbidden=()=>{throw new Error('unexpected native/model operation')};
const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
const services={settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},clientScenesService:{list:async()=>({code:0,data:[]})},modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})},acpService};
const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
function Fixture(){
const [ids,setIds]=useState(['A','B']);const [epochs,setEpochs]=useState([0,0]);const [focus,setFocus]=useState(0);const [identities,setIdentities]=useState([undefined,undefined]);
window.__splitQ={snapshots,events,holdDelete:()=>holdDelete=true,deleting:()=>Boolean(heldDelete),releaseDelete:()=>{heldDelete?.();heldDelete=null},dropAcceptance:()=>dropNextAcceptance=true,newDraft:()=>{setIds(prev=>prev.map((id,i)=>i===0?null:id));setEpochs(prev=>prev.map((n,i)=>i===0?n+1:n))},connect:()=>finishCreate?.(),identity:(index,value)=>{snapshots[ids[index]].workspaceIdentity=value;setIdentities(prev=>prev.map((old,i)=>i===index?value:old))},holdA:()=>holdA=true,releaseA:()=>{heldPrompt?.();heldPrompt=null},switch:(index,id)=>setIds(prev=>prev.map((old,i)=>i===index?id:old)),remount:index=>setEpochs(prev=>prev.map((n,i)=>i===index?n+1:n)),publish};
return <main className='h-screen w-screen flex bg-background text-foreground' data-fixture-ready='true'>{ids.map((id,index)=><section key={index} data-lane={index} className='h-full min-w-0 w-1/2' onPointerDownCapture={()=>setFocus(index)}><SessionPane key={epochs[index]} paneId={'lane-'+index} workspacePath={workspacePath} workspaceIdentity={identities[index]} remoteSessionId={remoteSessionId} sessionId={null} focused={focus===index} acpBoundSessionId={id} acpOpenRequest={id?{requestId:epochs[index]+1,session:copy(id)}:null}/></section>)}</main>;
}
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><V4ConversationContext.Provider value={native as never}><Fixture/></V4ConversationContext.Provider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const [delivery, width] of [
    ["continuous", 1280],
    ["replayable", 375],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack));
    await page.goto(
      `${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html?delivery=${delivery}`,
    );
    const lane = (i) => page.locator('[data-lane="' + i + '"]');
    const input = (i) => lane(i).locator('[data-testid="v4-composer-input"]');
    await lane(0)
      .locator('[data-testid="v4-queue-item-q-A"]')
      .waitFor({ timeout: 20000 })
      .catch((e) => {
        throw Error(errors.join("\n") || e.message);
      });
    await lane(1).locator('[data-testid="v4-queue-item-q-B"]').waitFor();
    // Seed an ambiguous old record: it must never become B's history draft.
    await page.evaluate(() =>
      localStorage.setItem(
        "zcode-v4-composer-drafts:v1:%2Fsynthetic%2Fqueue-split",
        JSON.stringify({
          version: 1,
          scopes: { __draft__: { text: "legacy ambiguous input", updatedAt: 0 } },
        }),
      ),
    );
    await input(0).fill("A draft");
    await page.waitForFunction(() =>
      Object.values(
        JSON.parse(
          localStorage.getItem("zcode-v4-composer-drafts:v1:%2Fsynthetic%2Fqueue-split") || "{}",
        ).scopes || {},
      ).some((draft) => draft.text === "A draft"),
    );
    await page.evaluate(() => window.__splitQ.remount(1));
    await lane(1).locator('[data-testid="v4-queue-item-q-B"]').waitFor();
    assert.equal(await input(1).textContent(), "", "B must not restore A or legacy root draft");
    await input(1).fill("B draft");
    await lane(0)
      .locator('input[type="file"]')
      .setInputFiles({
        name: "only-A.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("synthetic attachment"),
      });
    await lane(0).locator('[data-testid^="v4-attachment-"]').first().waitFor();
    assert.equal(
      await lane(1).locator('[data-testid^="v4-attachment-"]').count(),
      0,
      "A attachment must not appear in B",
    );
    await page.evaluate(() => window.__splitQ.switch(0, "C"));
    await lane(0).locator('[data-testid="v4-queue-item-q-C"]').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="0"] [data-testid="v4-composer-input"]')?.textContent ===
        "",
    );
    assert.equal(await lane(0).locator('[data-testid^="v4-attachment-"]').count(), 0);
    await input(0).fill("C quick switch");
    await page.evaluate(() => window.__splitQ.switch(0, "A"));
    await lane(0).locator('[data-testid="v4-queue-item-q-A"]').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="0"] [data-testid="v4-composer-input"]')?.textContent ===
        "A draft",
    );
    await lane(0).locator('[data-testid^="v4-attachment-"]').first().waitFor();
    await page.evaluate(() => window.__splitQ.switch(0, "C"));
    await lane(0).locator('[data-testid="v4-queue-item-q-C"]').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="0"] [data-testid="v4-composer-input"]')?.textContent ===
        "C quick switch",
      null,
      { timeout: 2000 },
    );
    await page.evaluate(() => window.__splitQ.switch(0, "A"));
    await lane(0).locator('[data-testid="v4-queue-item-q-A"]').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="0"] [data-testid="v4-composer-input"]')?.textContent ===
        "A draft",
    );

    // Real RPC receipt clears B even when every acceptance notification is suppressed.
    await page.evaluate(() => window.__splitQ.dropAcceptance());
    await lane(1).locator('[data-testid="v4-composer-send"]').click();
    await page.waitForFunction(() =>
      window.__splitQ.snapshots.B.queue.items.some((row) => row.text === "B draft"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="1"] [data-testid="v4-composer-input"]')?.textContent ===
        "",
    );
    assert.equal(await input(0).textContent(), "A draft", "B ACK must not clear A");
    assert.equal(await lane(0).locator('[data-testid^="v4-attachment-"]').count(), 1);
    assert.equal(await lane(0).locator('[data-testid="v4-queue-item-q-B"]').count(), 0);
    await page.evaluate(() => window.__splitQ.remount(0));
    await lane(0).locator('[data-testid="v4-queue-item-q-A"]').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="0"] [data-testid="v4-composer-input"]')?.textContent ===
        "A draft",
    );
    // Same path/session id on another workspace identity must not restore local drafts.
    await input(1).fill("B local identity");
    await page.evaluate(() => window.__splitQ.identity(1, "remote:synthetic"));
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="1"] [data-testid="v4-composer-input"]')?.textContent ===
        "",
    );
    await input(1).fill("B remote identity");
    await page.evaluate(() => window.__splitQ.identity(1, undefined));
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="1"] [data-testid="v4-composer-input"]')?.textContent ===
        "B local identity",
    );

    // A prompt admission is delayed while the same pane switches to C. C remains usable.
    await page.evaluate(() => window.__splitQ.holdA());
    await lane(0).locator('[data-testid="v4-composer-send"]').click();
    await page.waitForFunction(() =>
      window.__splitQ.events.some((e) => e.op === "prompt" && e.id === "A"),
    );
    await lane(0).locator('[data-testid="v4-queue-submission"]').waitFor({ timeout: 1000 });
    assert.match(
      await lane(0).locator('[data-testid="v4-queue-submission"]').textContent(),
      /A draft/,
    );
    assert.equal(await lane(1).locator('[data-testid="v4-queue-submission"]').count(), 0);
    await input(0).fill("A typed after submission");
    await page.evaluate(() => window.__splitQ.switch(0, "C"));
    await lane(0).locator('[data-testid="v4-queue-item-q-C"]').waitFor();
    assert.equal(await lane(0).locator('[data-testid="v4-queue-submission"]').count(), 0);
    await input(0).fill("C after navigation");
    assert.equal(
      await lane(0).locator('[data-testid="v4-composer-send"]').isDisabled(),
      false,
      "A admission must not block C",
    );
    await page.evaluate(() => window.__splitQ.releaseA());
    await page.waitForFunction(() =>
      window.__splitQ.snapshots.A.queue.items.some((row) => row.text === "A draft"),
    );
    assert.equal(await input(0).textContent(), "C after navigation", "A ACK must not clear C");
    await lane(0).locator('[data-testid="v4-composer-send"]').click();
    await page.waitForFunction(() =>
      window.__splitQ.snapshots.C.queue.items.some((row) => row.text === "C after navigation"),
    );
    await page.evaluate(() => window.__splitQ.switch(0, "A"));
    await lane(0).locator('[data-testid="v4-queue-item-q-A"]').waitFor();
    assert.equal(
      await input(0).textContent(),
      "A typed after submission",
      "late ACK must preserve newer input in its own scope",
    );
    // A delayed withdrawal ACK cannot restore A into C, including replayable attachments.
    // Lexical 草稿通过真实键盘删除提交变更，避免 fill 只改 DOM 后直接触发撤回。
    await input(1).press("ControlOrMeta+A");
    await input(1).press("Backspace");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="1"] [data-testid="v4-composer-input"]')?.textContent ===
        "",
    );
    await page.evaluate(() => window.__splitQ.holdDelete());
    await lane(1).getByTestId("v4-queue-item-edit-q-B").click();
    await page.waitForFunction(() => window.__splitQ.deleting());
    await page.evaluate(() => window.__splitQ.switch(1, "C"));
    await lane(1).getByTestId("v4-queue-item-q-C").waitFor();
    await input(1).fill("C draft during B withdrawal");
    await page.evaluate(() => window.__splitQ.releaseDelete());
    await page.waitForFunction(
      () => !window.__splitQ.snapshots.B.queue.items.some((item) => item.commandId === "q-B"),
    );
    assert.equal(await input(1).textContent(), "C draft during B withdrawal");
    // Returning to B must not revive its superseded restore operation.
    await page.evaluate(() => window.__splitQ.switch(1, "B"));
    await page.waitForFunction(
      () =>
        document.querySelector('[data-lane="1"] [data-testid="v4-composer-input"]')?.textContent ===
        "",
    );
    // 25 items in a half-height pane must scroll inside the queue, keeping input visible.
    await page.evaluate(() => {
      document.querySelector("main").classList.add("flex-col");
      for (const lane of document.querySelectorAll("[data-lane]")) {
        lane.classList.remove("h-full", "w-1/2");
        lane.classList.add("h-1/2", "w-full");
      }
      for (let i = 0; i < 24; i++)
        window.__splitQ.snapshots.A.queue.items.push({
          commandId: "bulk-" + i,
          text: "long queue " + i,
          attachments: [],
          workspaceFiles: [],
          state: "queued",
          createdAt: Date.now(),
        });
      window.__splitQ.publish("A");
    });
    await lane(0).locator('[data-testid="v4-queue-item-bulk-23"]').waitFor({ state: "attached" });
    const list = lane(0).locator("[data-v4-queue-list]");
    await list.waitFor();
    assert.ok(await list.evaluate((e) => e.scrollHeight > e.clientHeight));
    await page.waitForFunction(() => {
      const lane = document.querySelector('[data-lane="0"]');
      const input = lane.querySelector('[data-testid="v4-composer-input"]');
      const r = input.getBoundingClientRect(),
        p = lane.getBoundingClientRect();
      return r.top >= p.top && r.bottom <= p.bottom;
    });
    await list.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await lane(0).locator('[data-testid="v4-queue-item-delete-bulk-23"]').click();
    await page.waitForFunction(
      () => !window.__splitQ.snapshots.A.queue.items.some((item) => item.commandId === "bulk-23"),
    );
    // Pending feedback must reveal itself inside a long queue without scrolling the pane.
    await list.evaluate((e) => (e.scrollTop = 0));
    await input(0).fill("long queue admission");
    await page.evaluate(() => window.__splitQ.holdA());
    await lane(0).locator('[data-testid="v4-composer-send"]').click();
    await lane(0).locator('[data-testid="v4-queue-submission"]').waitFor({ timeout: 1000 });
    assert.ok(
      await lane(0)
        .locator('[data-testid="v4-queue-submission"]')
        .evaluate((e) => {
          const row = e.getBoundingClientRect(),
            list = e.parentElement.getBoundingClientRect();
          return row.top >= list.top && row.bottom <= list.bottom + 1;
        }),
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          "theme-zai-" + theme + (theme === "dark" ? " dark" : "");
      }, theme);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      await page.screenshot({ path: join(artifacts, `split-${width}-${theme}.png`) });
    }
    await page.evaluate(() => window.__splitQ.releaseA());
    await lane(0).locator('[data-testid="v4-queue-submission"]').waitFor({ state: "detached" });
    if (width === 1280) {
      await page.evaluate(() => window.__splitQ.newDraft());
      await lane(0).getByTestId("chat-model-select-trigger").click();
      await page.getByTestId("chat-model-select-item-acp:codex").click();
      await input(0).fill("typed while connecting");
      await lane(0)
        .locator('input[type="file"]')
        .setInputFiles({
          name: "connecting.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("synthetic"),
        });
      await page.evaluate(() => window.__splitQ.connect());
      await page.waitForFunction(
        () =>
          document.querySelector('[data-lane="0"] [data-testid="v4-composer-send"]')?.disabled ===
          false,
      );
      assert.equal(
        await input(0).textContent(),
        "typed while connecting",
        "new connection must retain its own waiting draft",
      );
      assert.equal(await lane(0).locator('[data-testid^="v4-attachment-"]').count(), 1);
      await lane(0).getByTestId("v4-composer-send").click();
      await page.waitForFunction(() =>
        window.__splitQ.snapshots.new.queue.items.some(
          (item) => item.text === "typed while connecting",
        ),
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `PASS split queue: draft/attachment isolation, switch/remount, RPC ACK without notifications, newer-draft preservation, continuous/replayable remount, long queue scrolling at 1280/375px. ${artifacts}`,
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
