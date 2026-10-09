// Real shared queue panel, CommandInbox and feedback; synthetic authority only.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__queue-feedback-${process.pid}`,
  html = join(root, name + ".html"),
  moduleFile = join(root, name + ".tsx");
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CommandInbox} from '../../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/command-inbox.ts';
import {ConversationQueuePanel} from '../../../ui/src/v4/ConversationQueuePanel.tsx';
import {projectAcpQueue} from '../../../ui/src/v4/acpQueueProjection.ts';
import {runQueueCommand} from '../../../ui/src/v4/queueCommandFeedback.ts';
import {toast} from '../../../ui/src/components/ui/toast.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
const events=[];
let mode='stale',current=true,revision=2,release;
const inbox=new CommandInbox({getRevision:()=>revision,getLogEpoch:()=>'synthetic-epoch'});
const queue=projectAcpQueue({autoDrain:false,pauseReason:'stopped',items:[{commandId:'item-a',text:'synthetic input',attachments:[],workspaceFiles:[],createdAt:1,state:'queued'}]});
window.__queueFeedback={events,mode:value=>mode=value,navigate:()=>current=false,release:()=>release?.()};
async function action(type,payload){
await runQueueCommand({
dispatch:async()=>{events.push(type);if(mode==='transport')throw Error('offline');if(mode==='delayed')await new Promise(resolve=>release=resolve);if(mode==='rejected')return {commandId:'synthetic',status:'rejected',revisionAtDecision:2};return (await inbox.handle({commandId:crypto.randomUUID(),clientId:'synthetic',sessionId:'session-a',type,payload,baseRevision:1,issuedAt:Date.now()})).ack},
isCurrent:()=>current,recover:()=>events.push('recover'),onFailure:kind=>toast('queue feedback: '+kind,{variant:'warning',position:'bottom-center',durationMs:60000})});
}
createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><main className="w-[360px] p-4 [container-type:size]" style={{height:500}}><ConversationQueuePanel queue={queue} onDeleteItem={id=>void action('deleteQueueItem',{queueItemId:id})} onEditItem={id=>action('deleteQueueItem',{queueItemId:id})} onSendNow={id=>void action('sendQueuedNow',{queueItemId:id})} onResume={()=>action('setAutoDrain',{autoDrain:true})}/></main></TooltipProvider></ZCodeIntlProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  await page
    .getByTestId("v4-queue")
    .waitFor({ timeout: 15000 })
    .catch((e) => {
      throw Error(errors.join("\n") || e.message);
    });
  for (const id of [
    "v4-queue-item-delete-item-a",
    "v4-queue-item-edit-item-a",
    "v4-queue-item-send-now-item-a",
    "v4-queue-resume",
  ]) {
    const prior = await page.evaluate(() => window.__queueFeedback.events.length);
    await page.getByTestId(id).click();
    await page.waitForFunction((n) => window.__queueFeedback.events.length === n + 2, prior);
    await page.getByText("queue feedback: stale", { exact: true }).first().waitFor();
  }
  assert.equal(
    await page.evaluate(() => window.__queueFeedback.events.filter((e) => e === "recover").length),
    4,
  );
  await page.evaluate(() => window.__queueFeedback.mode("transport"));
  await page.getByTestId("v4-queue-item-delete-item-a").click();
  await page.getByText("queue feedback: transport", { exact: true }).waitFor();
  await page.evaluate(() => window.__queueFeedback.mode("rejected"));
  await page.getByTestId("v4-queue-item-send-now-item-a").click();
  await page.getByText("queue feedback: rejected", { exact: true }).waitFor();
  await page.evaluate(() => window.__queueFeedback.mode("delayed"));
  const prior = await page.evaluate(() => window.__queueFeedback.events.length);
  await page.getByTestId("v4-queue-item-delete-item-a").click();
  await page.waitForFunction((n) => window.__queueFeedback.events.length === n + 1, prior);
  await page.evaluate(() => {
    window.__queueFeedback.navigate();
    window.__queueFeedback.release();
  });
  // A subsequent browser task executes after the resolved operation's microtasks.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() => window.__queueFeedback.events.filter((e) => e === "recover").length),
    4,
  );
  assert.equal(await page.getByText("queue feedback: stale", { exact: true }).count(), 4);
  assert.deepEqual(errors, []);
  console.log(
    "PASS queue feedback: stale recovery, no replay, transport/rejection feedback, late navigation guard.",
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
