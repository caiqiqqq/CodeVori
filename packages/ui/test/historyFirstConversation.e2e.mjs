// Real timeline and composer; synthetic history and runtime state, no Agent request.
// Run with desktop Vite: node packages/ui/test/historyFirstConversation.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__history-first-conversation-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import '../../../ui/src/styles.css';
const calls={retry:0,send:[]};
const services={clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},fileService:{searchWorkspaceFiles:async()=>[]},pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})}};
const platform={isMacOS:false,isWindows:false,isLinux:true,isWeb:true};
const rows=[{kind:'userInput',rowId:1,turnId:'turn-1',createdAt:1,createdAtSeq:1,text:'持久历史仍可阅读',origin:'realUser'}];
const noop=()=>{};
function Fixture(){
  const [status,setStatus]=useState('initializing');
  const [draft,setDraft]=useState({text:'',updatedAt:0});
  const snapshot={sessionId:'history',runtimeInitialization:{status,attemptId:'attempt-1',...(status==='failed'?{reasonCode:'fault.subscribe.resumeFailed',message:'fixture failure'}:{})},config:{mode:'build',followupMode:'queue'},inputRouting:{mode:'startNow'},control:{canStop:false,phase:'idle'},rows:{window:rows,totalCount:1,firstRowId:1},usage:null,queue:{items:[]},backgroundWorks:[]};
  window.__historyFirst={calls,fail:()=>setStatus('failed'),ready:()=>setStatus('ready'),status:()=>status};
  const composer=<ConversationComposer snapshot={snapshot as never} sessionId="history" workspacePath="/synthetic/history" attachmentSessionId="history" composerDraft={draft}
    updateComposerContent={content=>setDraft(current=>({...current,...content,updatedAt:Date.now()}))}
    replaceComposerDraft={content=>setDraft({...content,updatedAt:Date.now()})}
    disabled={status!=='ready'} onRetryInitialization={()=>{calls.retry++;setStatus('initializing')}}
    attachmentPut={async()=>{throw Error('unexpected attachment')}} onSendText={async text=>{calls.send.push(text);return 'history'}}
    onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop}
    autoFocusEnabled={false} listenAddToChatEvents={false}/>;
  return <main className="h-dvh bg-background text-foreground" data-status={status}>
    <ConversationTimeline rows={rows as never} totalCount={1} sessionKey="history" rowContext={{workspacePath:'/synthetic/history',theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS} as never} bottomDock={composer}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    const history = page.getByText("持久历史仍可阅读");
    const input = page.getByTestId("v4-composer-input");
    const send = page.getByTestId("v4-composer-send");
    await history.waitFor({ timeout: 15000 }).catch((error) => {
      throw new Error(errors.join("\n") || error.message);
    });
    await input.waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => window.__historyFirst.fail());
    await page.getByTestId("v4-session-initialization").waitFor();
    assert.equal(await history.isVisible(), true);
    assert.equal(await send.isDisabled(), true);
    await page.getByTestId("v4-session-initialization-retry").click();
    assert.equal(await page.evaluate(() => window.__historyFirst.calls.retry), 1);
    assert.equal(await history.isVisible(), true);
    assert.equal(await send.isDisabled(), true);
    await page.evaluate(() => window.__historyFirst.ready());
    await page.waitForFunction(() => document.querySelector("main")?.dataset.status === "ready");
    await input.fill("继续处理");
    await send.click();
    await page.waitForFunction(() => window.__historyFirst.calls.send.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__historyFirst.calls.send), ["继续处理"]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("History-first timeline/composer E2E passed at 1280/375px.");
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
