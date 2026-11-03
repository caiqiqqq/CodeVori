// Run with the desktop Vite server. Synthetic ACP admission; no Agent or network call.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-web-element-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
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
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {dispatchWebElementContextAddToChat} from '../../../ui/src/lib/webElementContext.ts';
import '../../../ui/src/styles.css';
const calls=[],pending=[];
const services={
clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
fileService:{searchWorkspaceFiles:async()=>[]},
pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},
subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
promptAttachmentTransferService:{onDynamicProgress:()=>()=>({dispose(){}}),stage:async()=>{throw Error('unused')},adopt:async()=>{},cleanup:async()=>{}},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})},
};
const platform={isMacOS:false,isWindows:false,isLinux:true,isWeb:true};
const noop=()=>{};
function Fixture(){
  const [draft,setDraft]=useState({text:'',updatedAt:0});
  window.__webElement={calls,pending,select:(id,identity='workspace-one')=>dispatchWebElementContextAddToChat({id,workspacePath:'/fixture',workspaceIdentity:identity,pageUrl:'https://example.test/page',pageTitle:'Example',tagName:'BUTTON',accessibleName:id,selector:'#'+id,capturedAt:1})};
  return <ConversationComposer snapshot={null} draftMode sessionId={null} composerScopeId="acp-draft"
    workspacePath="/fixture" workspaceIdentity="workspace-one" composerDraft={draft}
    updateComposerContent={content=>setDraft(current=>({...current,...content,updatedAt:Date.now()}))}
    replaceComposerDraft={content=>setDraft({...content,updatedAt:Date.now()})}
    attachmentPut={async()=>{throw Error('unused')}} onSendText={async()=>{throw Error('API send must not run')}}
    onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop}
    acpAgent="codex" acpReady onSendAcpText={async input=>{calls.push(input);return await new Promise((resolve,reject)=>pending.push({resolve,reject}))}}
    listenAddToChatEvents={false} listenWebElementContextEvents={true} autoFocusEnabled={false}/>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    const send = page.getByTestId("v4-composer-send");
    const chip = page.getByText("1 个网页元素");
    await send.waitFor().catch((error) => {
      throw new Error(errors.join("; ") || error.message);
    });
    await page.evaluate(() => window.__webElement.select("wrong", "other-workspace"));
    assert.equal(await chip.count(), 0, "another workspace must not receive the element");
    await page.evaluate(() => window.__webElement.select("first"));
    await chip.waitFor();
    assert.equal(await send.isEnabled(), true, "an element alone can be sent to ACP");
    await send.click();
    await page.waitForFunction(() => window.__webElement.calls.length === 1);
    const first = await page.evaluate(() => window.__webElement.calls[0]);
    assert.match(first.text, /# Web page elements:/);
    assert.match(first.text, /Selector: #first/);
    assert.match(first.text, /URL: https:\/\/example\.test\/page/);
    assert.deepEqual(first.attachments, []);
    await page.evaluate(() => window.__webElement.pending[0].reject(Error("synthetic rejection")));
    await chip.waitFor();
    assert.equal(await send.isEnabled(), true, "failed admission retains the element");
    await send.click();
    await page.waitForFunction(() => window.__webElement.calls.length === 2);
    await page.evaluate(() => window.__webElement.select("second"));
    await page.getByText("2 个网页元素").waitFor();
    await page.evaluate(() => window.__webElement.pending[1].resolve("acp-draft"));
    await chip.waitFor();
    assert.equal(await page.getByText("2 个网页元素").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: ACP element pickup, element-only send, workspace isolation, retry, in-flight selection and desktop/mobile layout.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
