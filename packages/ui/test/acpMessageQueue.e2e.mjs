// Real SessionPane/composer/queue, synthetic Host, no user history or real Agent prompts.
// ZCODE_E2E_BASE_URL=http://localhost:5174 node packages/ui/test/acpMessageQueue.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-message-queue-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "codevori-acp-queue-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
      import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
      const workspacePath='/synthetic/queue';
      const listeners=new Set(); const events=[];
      let holdNext=false, held=null, dropAcceptance=false, deleteMode='normal', heldDelete=null, lastInput=null;
      let snapshot={id:crypto.randomUUID(),agent:'codex',workspacePath,acpSessionId:'native-fixture',
        title:'queue fixture',revision:1,status:'running',entries:[{id:'user:first',kind:'user',text:'first task'}],
        configOptions:[],modeState:null,contextUsage:null,usageTurns:[],goal:null,pendingPermission:null,error:null,
        queue:{items:[],autoDrain:true}};
      const copy=()=>structuredClone(snapshot);
      const publish=()=>{snapshot={...snapshot,revision:snapshot.revision+1};for(const listener of listeners) listener({kind:'updated',session:copy()});return copy()};
      const requireItem=id=>{const item=snapshot.queue.items.find(item=>item.commandId===id);if(!item||item.state!=='queued') throw new Error('queue item unavailable');return item};
      const acpService={
        list:async()=>[copy()],read:async()=>copy(),refresh:async()=>copy(),
        listAvailableAgents:async()=>[{agent:'codex',available:true}],listAgentConfigs:async()=>[],
        listPlugins:async()=>[], onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),
        onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}} ,
        submitPrompt:async input=>{lastInput=input;events.push('prompt:'+input.text);if(holdNext){holdNext=false;await new Promise((resolve,reject)=>held={input,resolve,reject});}if(!snapshot.queue.items.some(item=>item.commandId===input.commandId))snapshot.queue.items.push({commandId:input.commandId,text:input.text,attachments:[],workspaceFiles:[],state:'queued',createdAt:Date.now()});if(dropAcceptance){dropAcceptance=false;snapshot.revision++;return copy()}return publish()},
        editQueueItem:async ({queueItemId,text})=>{requireItem(queueItemId).text=text;events.push('edit');return publish()},
        deleteQueueItem:async ({queueItemId,expectedItem})=>{if(deleteMode==='fail'){events.push('delete-failed');deleteMode='normal';throw Error('synthetic delete rejected')}if(deleteMode==='hold'){deleteMode='normal';await new Promise(resolve=>heldDelete=resolve)}const item=requireItem(queueItemId);if(expectedItem&&(item.text!==expectedItem.text||item.state!==expectedItem.state||item.createdAt!==expectedItem.createdAt))throw Error('changed');(snapshot.queue.discardedCommandIds??=[]).push(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(item=>item.commandId!==queueItemId);events.push('delete');return publish()},
        reorderQueueItem:async ({queueItemId,beforeQueueItemId})=>{const item=requireItem(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(candidate=>candidate!==item);const index=beforeQueueItemId?snapshot.queue.items.findIndex(item=>item.commandId===beforeQueueItemId):snapshot.queue.items.length;snapshot.queue.items.splice(index,0,item);events.push('move');return publish()},
        sendQueuedNow:async ({queueItemId})=>{const item=requireItem(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(candidate=>candidate!==item);snapshot.entries.push({id:'user:'+queueItemId,kind:'user',text:item.text});events.push('sendNow');return publish()},
        setQueueAutoDrain:async ({autoDrain})=>{snapshot.queue.autoDrain=autoDrain;delete snapshot.queue.pauseReason;events.push('resume');return publish()},
        stop:async()=>{snapshot.status='idle';snapshot.queue.autoDrain=false;snapshot.queue.pauseReason='stopped';events.push('stop');return publish()},
        readAttachment:async()=>({dataBase64:btoa('frozen bytes'),mediaType:'text/plain',totalBytes:12,nextOffset:null}),
        remove:async()=>{},
      };
      const forbidden=()=>{throw new Error('unexpected native/model operation')};
      const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,
        onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
      const services={settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
        clientScenesService:{list:async()=>({code:0,data:[]})},
        modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})},acpService};
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      function Fixture(){
        const [epoch,setEpoch]=useState(0);
        window.__queue={events,read:copy,lastInput:()=>lastInput,deleteMode:value=>deleteMode=value,deleting:()=>Boolean(heldDelete),releaseDelete:()=>{heldDelete?.();heldDelete=null},seedFile:()=>{snapshot.queue.items.push({commandId:'file-edit',text:'inspect [source.txt](./src/source.txt)',attachments:[{ref:'acp-attachment:00000000-0000-4000-8000-000000000000/0',fileName:'note.txt',mime:'text/plain',bytes:12}],workspaceFiles:['src/source.txt'],state:'queued',createdAt:Date.now()});publish()},hold:()=>holdNext=true,release:()=>{held?.resolve();held=null},reject:()=>{held?.reject(Error('synthetic admission failed'));held=null},acceptBeforeAck:()=>{const input=held.input;snapshot.queue.items.push({commandId:input.commandId,text:input.text,attachments:[],workspaceFiles:[],state:'queued',createdAt:Date.now()});publish()},dropAcceptance:()=>dropAcceptance=true,replay:()=>{publish();setEpoch(n=>n+1)},pause:()=>{snapshot.queue.autoDrain=false;snapshot.queue.pauseReason='error';publish()}};
        return <main className="h-screen bg-background text-foreground p-2" data-fixture-ready="true">
          <SessionPane key={epoch} paneId="queue-fixture" workspacePath={workspacePath} sessionId={null} focused
            acpBoundSessionId={snapshot.id} acpOpenRequest={{requestId:epoch+1,session:copy()}} />
        </main>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><V4ConversationContext.Provider value={native as never}><Fixture/></V4ConversationContext.Provider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    const input = page.locator('[data-testid="v4-composer-input"]');
    await input.waitFor({ timeout: 15000 }).catch((error) => {
      throw new Error(errors.join("\n") || error.message);
    });
    await page.locator('[data-testid="v4-stop"]').waitFor();
    const pending = page.locator('[data-testid="v4-queue-submission"]');
    // No timer: the Host stays unaccepted until explicitly released by this test.
    await page.evaluate(() => window.__queue.hold());
    await input.fill("delayed admission");
    await page.locator('[data-testid="v4-composer-send"]').click();
    await pending.waitFor({ timeout: 1000 });
    assert.match(await pending.textContent(), /delayed admission.*正在添加/);
    assert.equal(await pending.locator("button").count(), 0);
    assert.equal(await page.evaluate(() => window.__queue.read().queue.items.length), 0);
    assert.equal(
      await page.locator('[data-testid="v4-queue"]').getAttribute("data-queue-count"),
      "0",
    );
    assert.equal(await input.textContent(), "delayed admission");
    await page.screenshot({ path: join(artifacts, `pending-${width}.png`) });
    // Failure rolls back feedback only. Retry must keep the commandId and original draft.
    const failedCommandId = await pending.getAttribute("data-command-id");
    await page.evaluate(() => window.__queue.reject());
    await pending.waitFor({ state: "detached" });
    assert.equal(await input.textContent(), "delayed admission");
    await page.evaluate(() => window.__queue.hold());
    await page.locator('[data-testid="v4-composer-send"]').click();
    await pending.waitFor({ timeout: 1000 });
    assert.equal(await pending.getAttribute("data-command-id"), failedCommandId);
    await input.fill("new input during admission");
    // Live acceptance before ACK replaces pending without two copies of the same command.
    await page.evaluate(() => window.__queue.acceptBeforeAck());
    await pending.waitFor({ state: "detached" });
    await page.locator(`[data-testid="v4-queue-item-${failedCommandId}"]`).waitFor();
    assert.equal(await input.textContent(), "new input during admission");
    await page.evaluate(() => window.__queue.release());
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="v4-composer-send"]')?.disabled,
    );
    assert.equal(await input.textContent(), "new input during admission");
    await page.locator(`[data-testid="v4-queue-item-delete-${failedCommandId}"]`).click();
    await page.waitForFunction(() => window.__queue.read().queue.items.length === 0);

    // Direct ACK is sufficient even if no live acceptance notification is delivered.
    await page.evaluate(() => {
      window.__queue.hold();
      window.__queue.dropAcceptance();
    });
    await input.fill("silent admission");
    await page.locator('[data-testid="v4-composer-send"]').click();
    await pending.waitFor({ timeout: 1000 });
    const silentCommandId = await pending.getAttribute("data-command-id");
    await page.evaluate(() => window.__queue.release());
    await pending.waitFor({ state: "detached" });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
    );
    await page.locator(`[data-testid="v4-queue-item-delete-${silentCommandId}"]`).click();
    await page.waitForFunction(() => window.__queue.read().queue.items.length === 0);
    const send = async (text) => {
      await input.fill(text);
      await page.locator('[data-testid="v4-composer-send"]').click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
      );
    };
    await send("second follow-up");
    await send("third follow-up");
    await send("fourth follow-up");
    const queue = page.locator('[data-testid="v4-queue"]');
    await page.waitForFunction(() => window.__queue.read().queue.items.length === 3);
    await queue.waitFor();
    let ids = await page.evaluate(() =>
      window.__queue.read().queue.items.map((item) => item.commandId),
    );
    // Existing drafts win; failed withdrawal leaves the queue unchanged.
    await input.fill("keep this draft");
    await page.locator(`[data-testid="v4-queue-item-edit-${ids[0]}"]`).click();
    assert.equal(await input.textContent(), "keep this draft");
    assert.equal(await page.evaluate(() => window.__queue.read().queue.items.length), 3);
    await input.press("ControlOrMeta+A");
    await input.press("Backspace");
    await page.waitForFunction(
      () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
    );
    await page.evaluate(() => window.__queue.deleteMode("fail"));
    await page.locator(`[data-testid="v4-queue-item-edit-${ids[0]}"]`).click();
    await page.getByText("未能把队列消息退回输入框，请重试。", { exact: true }).waitFor();
    assert.equal(await input.textContent(), "");
    assert.equal(await page.evaluate(() => window.__queue.read().queue.items.length), 3);
    await page.evaluate(() => window.__queue.deleteMode("hold"));
    await page.locator(`[data-testid="v4-queue-item-edit-${ids[0]}"]`).click();
    await page.waitForFunction(() => window.__queue.deleting());
    assert.equal(await input.textContent(), "");
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="v4-composer-input"]')
          ?.getAttribute("contenteditable") === "false",
    );
    await page.evaluate(() => window.__queue.releaseDelete());
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="v4-composer-input"]')?.textContent ===
        "second follow-up",
    );
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__queue.read().queue.items.length), 2);
    await send("edited follow-up");
    const replacement = await page.evaluate(
      () => window.__queue.read().queue.items.at(-1).commandId,
    );
    assert.notEqual(replacement, ids[0]);
    ids = [ids[1], replacement, ids[2]];
    await page.locator(`[data-testid="v4-queue-item-delete-${ids[2]}"]`).click();
    await page.waitForFunction(() => window.__queue.read().queue.items.length === 2);
    const from = await page
      .locator(`[data-v4-queue-drag-handle][data-queue-item-id="${ids[1]}"]`)
      .boundingBox();
    const to = await page
      .locator(`[data-v4-queue-drag-handle][data-queue-item-id="${ids[0]}"]`)
      .boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      (id) => window.__queue.read().queue.items[0].commandId === id,
      ids[1],
    );
    assert.equal(await page.evaluate(() => window.__queue.read().queue.items.length), 2);
    await input.click(); // Finish the drag's click-suppression cycle before the next command.
    await page.locator('[data-testid="v4-stop"]').click();
    await page.locator('[data-testid="v4-queue-paused-banner"]').waitFor();
    await page.locator('[data-testid="v4-queue-resume"]').click();
    await page.waitForFunction(() => window.__queue.read().queue.autoDrain);
    await page.evaluate(() => window.__queue.pause());
    await page.evaluate(() => window.__queue.replay());
    await page.locator('[data-testid="v4-queue-paused-banner"]').waitFor();
    await page.locator(`[data-testid="v4-queue-item-${ids[0]}"]`).waitFor();
    assert.equal(await page.locator(`[data-testid="v4-queue-item-${ids[0]}"]`).count(), 1);
    await page.locator(`[data-testid="v4-queue-item-send-now-${ids[0]}"]`).click();
    await page.waitForFunction(() => window.__queue.read().queue.items.length === 1);
    assert.equal(await queue.getAttribute("data-queue-auto-drain"), "false");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.evaluate(() => window.__queue.seedFile());
    await page.getByTestId("v4-queue-item-edit-file-edit").click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="v4-composer-input"]')
        ?.textContent?.includes("source.txt"),
    );
    await page.locator('[data-testid^="v4-attachment-"]').first().waitFor();
    await page.getByTestId("v4-composer-send").click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "",
    );
    const restoredInput = await page.evaluate(() => window.__queue.lastInput());
    assert.equal(restoredInput.text, "inspect [source.txt](./src/source.txt)");
    assert.deepEqual(restoredInput.workspaceFiles, ["src/source.txt"]);
    assert.equal(
      Buffer.from(restoredInput.attachments[0].dataBase64, "base64").toString(),
      "frozen bytes",
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.classList.remove("theme-zai-light", "theme-zai-dark", "dark");
        document.documentElement.classList.add("theme-zai-" + theme);
        if (theme === "dark") document.documentElement.classList.add("dark");
      }, theme);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      await page.screenshot({ path: join(artifacts, `queue-${theme}-${width}.png`) });
    }
    assert.deepEqual(errors, [], errors.join("\n"));
    await page.close();
  }
  console.log(
    `PASS: API-style withdrawal, draft conflicts, rejection/delayed ACK, frozen file and mention restoration, immediate pending feedback, failure/retry, live-before-ACK, silent ACK, newer drafts, running composer admission, edit/delete/drag/send-now/resume and replay at 1280/375px in both themes. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
