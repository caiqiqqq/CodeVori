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
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
      const workspacePath='/synthetic/queue';
      const listeners=new Set(); const events=[];
      let snapshot={id:crypto.randomUUID(),agent:'codex',workspacePath,acpSessionId:'native-fixture',
        title:'queue fixture',revision:1,status:'running',entries:[{id:'user:first',kind:'user',text:'first task'}],
        configOptions:[],modeState:null,contextUsage:null,goal:null,pendingPermission:null,error:null,
        queue:{items:[],autoDrain:true}};
      const copy=()=>structuredClone(snapshot);
      const publish=()=>{snapshot={...snapshot,revision:snapshot.revision+1};for(const listener of listeners) listener({kind:'updated',session:copy()});return copy()};
      const requireItem=id=>{const item=snapshot.queue.items.find(item=>item.commandId===id);if(!item||item.state!=='queued') throw new Error('queue item unavailable');return item};
      const acpService={
        list:async()=>[copy()],read:async()=>copy(),refresh:async()=>copy(),
        listAvailableAgents:async()=>[{agent:'codex',available:true}],listAgentConfigs:async()=>[],
        listPlugins:async()=>[], onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),
        onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}} ,
        prompt:async input=>{events.push('prompt:'+input.text);snapshot.queue.items.push({commandId:input.commandId,text:input.text,attachments:[],workspaceFiles:[],state:'queued',createdAt:Date.now()});return publish()},
        editQueueItem:async ({queueItemId,text})=>{requireItem(queueItemId).text=text;events.push('edit');return publish()},
        deleteQueueItem:async ({queueItemId})=>{requireItem(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(item=>item.commandId!==queueItemId);events.push('delete');return publish()},
        reorderQueueItem:async ({queueItemId,beforeQueueItemId})=>{const item=requireItem(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(candidate=>candidate!==item);const index=beforeQueueItemId?snapshot.queue.items.findIndex(item=>item.commandId===beforeQueueItemId):snapshot.queue.items.length;snapshot.queue.items.splice(index,0,item);events.push('move');return publish()},
        sendQueuedNow:async ({queueItemId})=>{const item=requireItem(queueItemId);snapshot.queue.items=snapshot.queue.items.filter(candidate=>candidate!==item);snapshot.entries.push({id:'user:'+queueItemId,kind:'user',text:item.text});events.push('sendNow');return publish()},
        setQueueAutoDrain:async ({autoDrain})=>{snapshot.queue.autoDrain=autoDrain;delete snapshot.queue.pauseReason;events.push('resume');return publish()},
        stop:async()=>{snapshot.status='idle';snapshot.queue.autoDrain=false;snapshot.queue.pauseReason='stopped';events.push('stop');return publish()},
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
        window.__queue={events,read:copy,replay:()=>{publish();setEpoch(n=>n+1)},pause:()=>{snapshot.queue.autoDrain=false;snapshot.queue.pauseReason='error';publish()}};
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
    const ids = await page.evaluate(() =>
      window.__queue.read().queue.items.map((item) => item.commandId),
    );
    await page.locator(`[data-testid="v4-queue-item-edit-${ids[0]}"]`).click();
    await page.locator('[data-testid="acp-queue-edit-text"]').fill("edited follow-up");
    await page.locator('[data-testid="acp-queue-edit-save"]').click();
    await page.waitForFunction(
      () => window.__queue.read().queue.items[0].text === "edited follow-up",
    );
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
    `PASS: running composer admission, edit/delete/drag/send-now/resume and replay at 1280/375px in both themes. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
