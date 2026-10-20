// Real Composer/Lexical; synthetic admission only, no user data or model calls.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__composer-submission-scope-${process.pid}`;
const html = join(root, name + ".html");
const moduleFile = join(root, name + ".tsx");
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import {LocalTtftObserver,setLocalTtftObserver} from '../../../ui/src/v4/telemetry/localTtftObserver.ts';
import '../../../ui/src/styles.css';
const calls=[],pending=[],tempTexts=[];
// 开启真实提交观测路径，确保手机缺少 randomUUID 时发送不会在生成观测 ID 处失败。
const ttft=new LocalTtftObserver(()=>{});
ttft.enabled=true;
setLocalTtftObserver(ttft);
const services={
clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
fileService:{searchWorkspaceFiles:async()=>[]},
pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},
subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
promptAttachmentTransferService:{onDynamicProgress:()=>()=>({dispose(){}}),stage:async input=>({ref:'artifact:synthetic-sql',bytes:input.sizeBytes,staged:true}),adopt:async()=>{},cleanup:async()=>{}},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})},
};
const platform={isMacOS:false,isWindows:false,isLinux:true,isWeb:true,createTempTextAttachment:async ({text,filename})=>{tempTexts.push(text);return {filename,localPath:'/synthetic/'+filename,mimeType:'text/plain',sizeBytes:new TextEncoder().encode(text).length}}};
const noop=()=>{};
function Fixture(){
const [target,setTarget]=useState({id:'A',identity:undefined});
const [drafts,setDrafts]=useState({});
const key=(target.identity||'/synthetic/submission')+':'+target.id;
const draft=drafts[key]??{text:'',updatedAt:0};
const update=useCallback(content=>setDrafts(current=>({...current,[key]:{...current[key],...content,updatedAt:Date.now()}})),[key]);
const replace=useCallback(content=>setDrafts(current=>({...current,[key]:{...content,updatedAt:Date.now()}})),[key]);
const snapshot=target.id==='__draft__'?null:{sessionId:target.id,config:{mode:'build',followupMode:'queue'},inputRouting:{mode:'startNow'},control:{canStop:target.id==='preempt',phase:target.id==='preempt'?'running':'idle'},rows:{totalCount:0},usage:null,queue:{items:[]},backgroundWorks:[]};
window.__submission={calls,pending,drafts,tempTexts,switch:(id,identity)=>setTarget({id,identity}),theme:applyTheme,
finish:(index,result)=>{pending[index].resolve(result)},fail:index=>pending[index].reject(Error('synthetic rejection'))};
return <main className="h-screen flex items-end p-4 bg-background text-foreground" data-target={target.id} data-identity={target.identity??''}>
<ConversationComposer snapshot={snapshot as never} draftMode={target.id==='__draft__'} sessionId={target.id==='__draft__'?null:target.id}
composerDraft={draft} updateComposerContent={update} replaceComposerDraft={replace}
workspacePath="/synthetic/submission" workspaceIdentity={target.identity}
remoteSessionId={new URLSearchParams(location.search).get('delivery')==='replayable'?'fixture-attachment':undefined}
attachmentPut={async()=>{throw Error('unexpected attachment')}}
attachmentSessionId={target.id}
onSendText={async (text,options)=>{calls.push({target:target.id,identity:target.identity,text,attachments:options?.attachments});return await new Promise((resolve,reject)=>pending.push({resolve,reject}))}}
onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop}
autoFocusEnabled={false} listenAddToChatEvents={false}/></main>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const [width, delivery] of [
    [1280, "continuous"],
    [375, "replayable"],
  ]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (width === 375) {
        // 局域网 HTTP 的移动浏览器没有 randomUUID；保留安全随机源复现真实能力差异。
        await page.addInitScript(() => {
          Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined });
        });
      }
      await page.goto(
        `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5189"}/${name}.html?delivery=${delivery}`,
      );
      const input = page.getByTestId("v4-composer-input");
      const send = page.getByTestId("v4-composer-send");
      if (width === 375) {
        assert.equal(await page.evaluate(() => typeof crypto.randomUUID), "undefined");
        assert.equal(await page.evaluate(() => typeof crypto.getRandomValues), "function");
      }
      await input.waitFor().catch((error) => {
        throw Error(errors.join("\n") || error.message);
      });
      await page.evaluate((theme) => window.__submission.theme(theme), theme);
      const frames = () =>
        page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      const switchTarget = async (id, identity) => {
        await page.evaluate(
          ([id, identity]) => window.__submission.switch(id, identity),
          [id, identity],
        );
        await page.locator(`main[data-target="${id}"]`).waitFor();
        await frames();
      };
      await frames();
      await input.click();
      assert.equal(await input.getAttribute("contenteditable"), "true");
      assert.equal(await input.evaluate((element) => document.activeElement === element), true);
      await input.fill("A awaiting ACK");
      assert.equal(await send.isEnabled(), true, "Typed mobile input can be submitted");
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 1);
      await switchTarget("B");
      const sql =
        "INSERT INTO synthetic_table(data) VALUES ('" + '{"key":"value"},'.repeat(900) + "');";
      await input.focus();
      await page.evaluate((sql) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", sql);
        document
          .querySelector('[data-testid="v4-composer-input"]')
          .dispatchEvent(
            new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
          );
      }, sql);
      await frames();
      assert.equal(await input.textContent(), sql, "Long SQL survives paste intact");
      assert.equal(await send.isEnabled(), true, "A's pending request must not block B");
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 2);
      await input.fill("B next input");
      await page.evaluate(() => window.__submission.finish(0, "sent"));
      await frames();
      assert.equal(await send.isDisabled(), true, "A's finally cannot release B's lock");
      assert.equal(await input.textContent(), "B next input", "A's ACK cannot clear B");
      await input.press("Enter");
      await frames();
      assert.equal(await page.evaluate(() => window.__submission.calls.length), 2);
      await page.evaluate(() => window.__submission.finish(1, "sent"));
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="v4-composer-send"]').disabled,
      );
      assert.match(await input.textContent(), /B next input/);
      assert.equal(await page.evaluate(() => window.__submission.calls[1].text), sql);

      // Same path/session but another remote workspace identity is a new target.
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 3);
      await switchTarget("B", "synthetic-remote");
      await input.fill("remote B awaiting ACK");
      assert.equal(await send.isEnabled(), true);
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 4);
      await page.evaluate(() => window.__submission.fail(2));
      await frames();
      assert.equal(await send.isDisabled(), true, "Old failure cannot release remote B's lock");
      assert.equal(await input.textContent(), "remote B awaiting ACK");
      await page.evaluate(() => window.__submission.finish(3, "confirmationRequired"));
      await page.getByTestId("v4-paused-queue-send-dialog").waitFor();
      await switchTarget("C");
      await page.getByTestId("v4-paused-queue-send-dialog").waitFor({ state: "detached" });
      assert.equal(
        await page.getByTestId("v4-paused-queue-send-dialog").count(),
        0,
        "Confirmation belongs to its target",
      );
      await input.fill("C awaiting ACK");
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 5);
      await switchTarget("D");
      await input.fill("D draft");
      await page.evaluate(() => window.__submission.finish(4, "confirmationRequired"));
      await frames();
      assert.equal(
        await page.getByTestId("v4-paused-queue-send-dialog").count(),
        0,
        "Late confirmation cannot open in D",
      );
      assert.equal(await input.textContent(), "D draft");
      assert.equal(await send.isEnabled(), true);

      await switchTarget("B", "synthetic-remote");
      assert.match(
        await input.textContent(),
        /remote B awaiting ACK/,
        "Original rejected draft remains retryable",
      );
      // Root promotion consumes the claimed draft before the delayed callback settles.
      await switchTarget("__draft__");
      await input.fill("root first input");
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 6);
      await switchTarget("promoted");
      assert.equal(await input.textContent(), "");
      await input.fill("promoted next input");
      await page.evaluate(() => window.__submission.finish(5, "sent"));
      await frames();
      assert.equal(await input.textContent(), "promoted next input");
      await switchTarget("__draft__");
      assert.equal(await input.textContent(), "", "Accepted root draft does not resurrect");

      // A current failure unlocks without losing the original text.
      await switchTarget("failure");
      await input.fill("retry this input");
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 7);
      await page.evaluate(() => window.__submission.fail(6));
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="v4-composer-send"]').disabled,
      );
      assert.equal(await input.textContent(), "retry this input");

      // The issue-sized SQL follows the existing >=15 Ki character paste-to-attachment path.
      await switchTarget("large-paste");
      const largeSql = sql + " synthetic data".repeat(450);
      await input.focus();
      await page.evaluate((sql) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", sql);
        document
          .querySelector('[data-testid="v4-composer-input"]')
          .dispatchEvent(
            new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
          );
      }, largeSql);
      await page.waitForFunction(() => window.__submission.tempTexts.length === 1);
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="v4-composer-send"]').disabled,
      );
      assert.equal(await input.textContent(), "");
      assert.equal(await page.evaluate(() => window.__submission.tempTexts[0]), largeSql);
      await send.click();
      await page.waitForFunction(() => window.__submission.pending.length === 8);
      assert.equal(await page.evaluate(() => window.__submission.calls[7].attachments.length), 1);
      await page.evaluate(() => window.__submission.finish(7, "sent"));
      await page.locator('[data-testid^="v4-attachment-"]').waitFor({ state: "detached" });

      // Immediate preemption must not restore old input after navigation.
      await switchTarget("preempt");
      await input.fill("preempt retry");
      await send.click({ modifiers: ["ControlOrMeta"] });
      await page.waitForFunction(() => window.__submission.pending.length === 9);
      assert.equal(await input.textContent(), "", "Preemption clears while waiting");
      await switchTarget("after-preempt");
      await input.fill("new target input");
      await page.evaluate(() => window.__submission.fail(8));
      await frames();
      assert.equal(await input.textContent(), "new target input");
      assert.equal(await send.isEnabled(), true);
      assert.deepEqual(errors, []);
      console.log(`PASS submission scope ${width}px ${theme} ${delivery}`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
