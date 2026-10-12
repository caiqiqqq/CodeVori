// Actual Composer/Lexical; synthetic Git and Agent admission, isolated browser storage.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-autosend-${process.pid}`,
  html = join(root, name + ".html"),
  moduleFile = join(root, name + ".tsx");
const artifacts = await mkdtemp(join(tmpdir(), "zcode-worktree-autosend-"));
let browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useDraftConfigControl} from '../../../ui/src/v4/composer/useDraftConfigControl.ts';
import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {WorktreeDraftIntentContext,shouldInheritWorktreeAutoSendDraft} from '../../../ui/src/v4/composer/worktreeDraftIntent.tsx';
import {readV4ComposerDraft,persistV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
import '../../../ui/src/styles.css';
const state:any={calls:[],creates:0,opens:[],pending:null};window.__worktree=state;
const services:any={settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},fileService:{searchWorkspaceFiles:async()=>[]},
pluginManagementService:{getPluginReferenceCatalog:async()=>({authority:'workspace',plugins:[]})},subagentsService:{list:async()=>[]},zcodeSessionService:{list:async()=>[]},
skillsService:{list:async()=>({skills:[],diagnostics:[],capability:{userScopeAvailable:true}})},
zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),getWorkspaceSlashCommandCatalog:async()=>({commands:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})}};
const noop=()=>{};const platform:any={isMacOS:false,isWindows:false,isLinux:true,isWeb:true};
function Fixture(){
const params=new URLSearchParams(location.search), agent=params.get('agent')==='api'?null:'codex';
const initialScope=agent?(params.get('scope')==='connected'?'acp:provisional-source':'acp-draft:workspace-main:codex'):'__draft__';
const [target,setTarget]=useState({path:'/synthetic/source',identity:undefined as string|undefined,scope:initialScope});
const [selected,setSelected]=useState(true),[autoSend,setAutoSend]=useState(null as any),[ready,setReady]=useState(true);
const provisional=target.path==='/synthetic/tree'&&target.scope==='acp:target';
const sourceScope=provisional?'acp-draft:workspace-main:codex':shouldInheritWorktreeAutoSendDraft(autoSend,target.path,target.identity,null,agent,target.scope.startsWith('acp-draft:'))?'__draft__':undefined;
const control=useDraftConfigControl({workspacePath:target.path,workspaceIdentity:target.identity,sessionId:null,composerScopeId:target.scope,composerDraftSourceScopeId:sourceScope,modelSelectionService:null,agentStartupAllowed:false});
const {composerDraft:draft,updateComposerContent:update,replaceComposerDraft:replace}=control;
state.rootDraft=()=>readV4ComposerDraft('/synthetic/tree',undefined,'__draft__');state.connectTarget=()=>setTarget(old=>({...old,scope:'acp:target'}));
state.setReady=setReady;state.editScope=()=>setTarget(old=>({...old,scope:'acp:history'}));state.navigate=()=>setTarget({path:'/synthetic/other',identity:undefined,scope:'__draft__'});state.remote=()=>setTarget(old=>({...old,identity:'remote'}));
state.finish=()=>{state.pending?.({ok:true,didCreate:true,branchName:'worktree/cafe',worktreePath:'/synthetic/tree',issues:[]});state.pending=null;};state.target=target;state.draft=draft;state.autoSend=autoSend;
const intent:any={selected,select:setSelected,autoSend,consumeAutoSend:()=>setAutoSend(null),createWorktree:async()=>{state.creates++;return await new Promise(resolve=>state.pending=resolve)},
openCreatedWorktree:(path,fullDraft,selectedAgent,trigger)=>{state.opens.push({path,draft:fullDraft,agent:selectedAgent});persistV4ComposerDraft(path,undefined,'__draft__',fullDraft);setSelected(false);setReady(false);setTarget({path,identity:undefined,scope:agent?'acp-draft:workspace-main:codex':'__draft__'});setAutoSend({requestId:1,workspacePath:path,draftFocusVersion:0,text:fullDraft.text.trim(),agent:selectedAgent,trigger});}};
return <WorktreeDraftIntentContext.Provider value={intent}><main className="min-h-dvh bg-background text-foreground p-4 flex items-end" data-path={target.path}>
<ConversationComposer snapshot={null} sessionId={null} composerScopeId={target.scope} composerDraftSourceScopeId={sourceScope} draftMode
composerDraft={draft} updateComposerContent={update} replaceComposerDraft={replace} workspacePath={target.path} workspaceIdentity={target.identity}
acpAgent={agent} acpSessionId={target.scope.startsWith('acp:')?target.scope.slice(4):null} acpReady={ready} disabled={!agent&&!ready}
onSendAcpText={async text=>{state.calls.push({path:target.path,kind:'acp',text:text.text});return 'sent'}}
onSendText={async text=>{state.calls.push({path:target.path,kind:'api',text});return 'sent'}}
onStop={noop} onSelectModel={noop} onSelectThought={noop} onSwitchMode={noop} autoFocusEnabled={false} listenAddToChatEvents={false}/></main></WorktreeDraftIntentContext.Provider>;
}
const initialParams=new URLSearchParams(location.search);const initialScope=initialParams.get('agent')==='api'?'__draft__':initialParams.get('scope')==='connected'?'acp:provisional-source':'acp-draft:workspace-main:codex';persistV4ComposerDraft('/synthetic/source',undefined,initialScope,{text:'',mode:'build',planEnabled:true,modelSelection:{providerId:'synthetic',modelId:'model'},updatedAt:0});
createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><TabStoreProvider><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true])
    for (const dark of [false, true])
      for (const kind of ["api", "draft", "connected"]) {
        page = await browser.newPage({
          viewport: { width: mobile ? 390 : 1000, height: 850 },
          isMobile: mobile,
          hasTouch: mobile,
        });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(
          `${process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5196"}/${name}.html?agent=${kind === "api" ? "api" : "codex"}&scope=${kind}`,
        );
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle("dark", dark),
          dark,
        );
        const input = page.getByTestId("v4-composer-input"),
          send = page.getByTestId("v4-composer-send");
        await input.waitFor();
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await input.fill("测试自动工作树首发");
        await send.click();
        await page.waitForFunction(() => window.__worktree.pending !== null);
        await page.evaluate(() => window.__worktree.finish());
        await page.locator('main[data-path="/synthetic/tree"]').waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="v4-composer-input"]')?.textContent ===
            "测试自动工作树首发",
        );
        assert.equal(
          await page.evaluate(() => window.__worktree.calls.length),
          0,
          "Wait for target readiness",
        );
        assert.equal(await page.evaluate(() => window.__worktree.opens[0].draft.planEnabled), true);
        assert.equal(
          await page.evaluate(() => window.__worktree.opens[0].draft.modelSelection.modelId),
          "model",
        );
        if (kind !== "api") {
          assert.equal(
            await page.evaluate(() => window.__worktree.rootDraft()),
            null,
            "Root staging draft consumed",
          );
          await page.evaluate(() => window.__worktree.connectTarget());
          await page.waitForFunction(
            () =>
              window.__worktree.target.scope === "acp:target" &&
              document.querySelector('[data-testid="v4-composer-input"]')?.textContent ===
                "测试自动工作树首发",
          );
        }
        await page.screenshot({
          path: join(
            artifacts,
            `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}-${kind}-pending.png`,
          ),
        });
        await page.evaluate(() => window.__worktree.setReady(true));
        await page.waitForFunction(() => window.__worktree.calls.length === 1);
        assert.deepEqual(await page.evaluate(() => window.__worktree.calls[0]), {
          path: "/synthetic/tree",
          kind: kind === "api" ? "api" : "acp",
          text: "测试自动工作树首发",
        });
        await page.evaluate(() => window.__worktree.setReady(false));
        await page.evaluate(() => window.__worktree.setReady(true));
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        assert.equal(await page.evaluate(() => window.__worktree.calls.length), 1);
        assert.equal(await page.evaluate(() => window.__worktree.creates), 1);
        await page.screenshot({
          path: join(
            artifacts,
            `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}-${kind}.png`,
          ),
        });
        await page.close();
        console.log("PASS automatic worktree first-send", mobile, dark, kind);
      }
  for (const action of ["edit", "navigate", "remote", "scope"]) {
    page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(
      `${process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5196"}/${name}.html?agent=codex&scope=connected`,
    );
    const input = page.getByTestId("v4-composer-input");
    await input.waitFor();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await input.fill("original");
    await page.getByTestId("v4-composer-send").click();
    await page.waitForFunction(() => window.__worktree.pending !== null);
    if (action === "edit") await input.fill("changed");
    else
      await page.evaluate((action) => {
        if (action === "scope") window.__worktree.editScope();
        else window.__worktree[action]();
      }, action);
    await page.evaluate(() => window.__worktree.finish());
    await page.waitForFunction(() => window.__worktree.pending === null);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.evaluate(() => window.__worktree.opens.length), 0);
    assert.equal(await page.evaluate(() => window.__worktree.calls.length), 0);
    if (action === "edit") assert.equal(await input.textContent(), "changed");
    await page.close();
    console.log("PASS stale source guard", action);
  }
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(
    `${process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5196"}/${name}.html?agent=codex&scope=draft`,
  );
  const editedTarget = page.getByTestId("v4-composer-input");
  await editedTarget.waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await editedTarget.fill("first input");
  await page.getByTestId("v4-composer-send").click();
  await page.waitForFunction(() => window.__worktree.pending !== null);
  await page.evaluate(() => window.__worktree.finish());
  await page.locator('main[data-path="/synthetic/tree"]').waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="v4-composer-input"]')?.textContent === "first input",
  );
  await editedTarget.fill("edited while connecting");
  await page.evaluate(() => window.__worktree.setReady(true));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.__worktree.calls.length), 0);
  assert.equal(await editedTarget.textContent(), "edited while connecting");
  await page.close();
  console.log("PASS target edit cancels late auto-send");
  assert.deepEqual(errors, []);
  console.log("Screenshots:", artifacts);
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  console.error({ errors, artifacts });
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
