// Real Composer owner: persistence, native promotion and provisional ACP inheritance.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__linked-draft-${process.pid}`;
const html = join(root, name + ".html"),
  moduleFile = join(root, name + ".tsx");
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useDraftConfigControl} from '../../../ui/src/v4/composer/useDraftConfigControl.ts';
import {persistV4ComposerDraft,readV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
import {parseComposerPromptContexts,serializeComposerPromptContexts} from '../../../ui/src/v4/composer/composerPromptContexts.ts';
import {buildPromptWithLinkedRepositories} from '../../../ui/src/lib/linkedRepositoryContext.ts';
import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
const rows=[{name:'backend',sourcePath:'/backend',baseBranch:'main',useWorktree:true,prepared:{executionPath:'/trees/backend',branchName:'worktree/one',baseCommit:'commit',sourceRepositoryPath:'/backend'}}];
const services:any={settingService:{get:async()=>({})},zcodeSessionService:{}};
const seed={text:'body',mode:'build',linkedRepositories:rows,updatedAt:1};
const apiBody=serializeComposerPromptContexts('original body',{codeComments:[],conversationSelections:[],webElements:[],pptxElements:[]});
const prompt=buildPromptWithLinkedRepositories(apiBody,rows);
const state:any={rows,seed,parse:parseComposerPromptContexts(prompt,{workspacePath:'/front'}),acp:buildAcpConversationRows({entries:[{id:'user:one',kind:'user',text:prompt}],status:'idle'} as never)};window.__draft=state;
state.read=(identity,scope)=>readV4ComposerDraft('/front',identity,scope);
state.persist=(identity,scope,draft)=>persistV4ComposerDraft('/front',identity,scope,draft);
function Probe(){const [view,setView]=useState({identity:undefined,scope:'__draft__',source:undefined});
 const owner=useDraftConfigControl({workspacePath:'/front',workspaceIdentity:view.identity,sessionId:view.scope==='__draft__'?null:view.scope,composerScopeId:view.scope,composerDraftSourceScopeId:view.source,sessionConfig:{mode:'build'},agentStartupAllowed:false,modelSelectionService:null});
 state.switch=(scope,identity,source)=>setView({scope,identity,source});state.owner=owner;state.scope=view.scope;state.identity=view.identity;
 return <div data-testid="draft-ready">{view.scope}</div>;
}
createRoot(document.getElementById('root')).render(<PlatformProvider platform={{isWeb:true} as never}><TabStoreProvider><ServiceProvider services={services}><Probe/></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ZCODE_CHROME_PATH,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
  await page.getByTestId("draft-ready").waitFor();
  await page.evaluate(() => window.__draft.owner.replaceComposerDraft(window.__draft.seed));
  await page.waitForFunction(
    () => window.__draft.owner.composerDraft.linkedRepositories?.length === 1,
  );
  await page.evaluate(() => {
    window.__draft.owner.updateComposerContent({ text: "" });
    window.__draft.owner.promoteComposerDraft("native-one");
  });
  assert.equal(await page.evaluate(() => window.__draft.read(undefined, "__draft__")), null);
  assert.equal(
    await page.evaluate(
      () =>
        window.__draft.read(undefined, "native-one").linkedRepositories[0].prepared.executionPath,
    ),
    "/trees/backend",
  );
  await page.evaluate(() => window.__draft.switch("native-one"));
  await page.waitForFunction(() => window.__draft.scope === "native-one");
  assert.equal(await page.evaluate(() => window.__draft.owner.composerDraft.text), "");
  await page.evaluate(() => window.__draft.switch("unrelated"));
  await page.waitForFunction(() => window.__draft.scope === "unrelated");
  assert.equal(
    await page.evaluate(() => window.__draft.owner.composerDraft.linkedRepositories),
    undefined,
  );
  await page.evaluate(() => {
    window.__draft.persist(undefined, "acp-draft", window.__draft.seed);
    window.__draft.switch("acp:one", undefined, "acp-draft");
  });
  await page.waitForFunction(
    () => window.__draft.read(undefined, "acp:one")?.linkedRepositories?.length === 1,
  );
  assert.equal(await page.evaluate(() => window.__draft.read(undefined, "acp-draft")), null);
  await page.evaluate(() => window.__draft.switch("acp:one", " remote-one "));
  await page.waitForFunction(() => window.__draft.identity === " remote-one ");
  assert.equal(
    await page.evaluate(() => window.__draft.owner.composerDraft.linkedRepositories),
    undefined,
  );
  await page.evaluate(() => window.__draft.owner.replaceComposerDraft(window.__draft.seed));
  assert.equal(
    await page.evaluate(
      () => window.__draft.read("remote-one", "acp:one").linkedRepositories.length,
    ),
    1,
  );
  assert.equal(await page.evaluate(() => window.__draft.read("remote-two", "acp:one")), null);
  await page.reload();
  await page.getByTestId("draft-ready").waitFor();
  await page.evaluate(() => window.__draft.switch("native-one"));
  await page.waitForFunction(() => window.__draft.scope === "native-one");
  assert.equal(
    await page.evaluate(
      () => window.__draft.owner.composerDraft.linkedRepositories[0].prepared.executionPath,
    ),
    "/trees/backend",
  );
  assert.equal(await page.evaluate(() => window.__draft.parse.visibleContent), "original body");
  assert.equal(
    await page.evaluate(() => window.__draft.acp.find((row) => row.kind === "userInput").text),
    "original body",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS linked draft persistence, identity, native promotion, ACP inheritance and history display",
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
