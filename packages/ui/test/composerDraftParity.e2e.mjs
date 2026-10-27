// Actual draft hook with synthetic services; no Agent startup or model request.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__draft-parity-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useDraftConfigControl} from '../../../ui/src/v4/composer/useDraftConfigControl.ts';
import {persistV4ComposerDraft} from '../../../ui/src/v4/composer/composerDraftStore.ts';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
const services:any={settingService:{get:async()=>({})},broadcastService:{onMessage:()=>({dispose(){}})}};
const selection={providerId:'fixture',modelId:'one'};
for(const w of ['/fixture-a','/fixture-b'])for(const scope of ['__draft__','session-1'])persistV4ComposerDraft(w,undefined,scope,{text:'',mode:'build',modelSelection:selection});
function Fixture(){const [workspace,setWorkspace]=useState('/fixture-a');const [session,setSession]=useState<string|null>(null);
 const c=useDraftConfigControl({workspacePath:workspace,sessionId:session,modelSelectionService:null,agentStartupAllowed:false});
 const api:any=window.__draftTest??={};api.control=c;api.switch=(w,s)=>{setWorkspace(w);setSession(s)};api.capture=()=>{api.ack=c.captureAcceptedModelSelection({providerId:'fixture',modelId:'auto'})};api.editLater=()=>{api.staleEdit=c.updateComposerContent};
 return <><input aria-label="draft" value={c.composerDraft.text} onChange={e=>c.updateComposerContent({text:e.target.value})}/><output>{c.composerDraft.modelSelection?.modelId}</output><button onClick={()=>c.handleDraftSelectModel('fixture','two')}>Model two</button></>;
}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><TabStoreProvider><Fixture/></TabStoreProvider></ServiceProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    const input = page.getByRole("textbox", { name: "draft" });
    await input.fill("editing text remains during model switch");
    await page.evaluate(() => window.__draftTest.capture());
    await page.getByRole("button", { name: "Model two" }).click();
    await page.evaluate(() => window.__draftTest.ack());
    assert.equal(await input.inputValue(), "editing text remains during model switch");
    assert.equal(await page.locator("output").innerText(), "two");
    await page.evaluate(() => window.__draftTest.editLater());
    await page.evaluate(() => window.__draftTest.switch("/fixture-b", null));
    await page.waitForFunction(() => document.querySelector("input").value === "");
    await input.fill("workspace B root");
    await page.evaluate(() => window.__draftTest.staleEdit({ text: "late A editor callback" }));
    assert.equal(await input.inputValue(), "workspace B root");
    await page.evaluate(() => window.__draftTest.switch("/fixture-a", "session-1"));
    await page.waitForFunction(() => document.querySelector("input").value === "");
    await input.fill("existing task draft");
    await page.evaluate(() => window.__draftTest.switch("/fixture-a", null));
    await page.waitForFunction(
      () => document.querySelector("input").value === "editing text remains during model switch",
    );
    assert.equal(await page.locator("output").innerText(), "two");
    await page.evaluate(() => window.__draftTest.switch("/fixture-a", "session-1"));
    await page.waitForFunction(
      () => document.querySelector("input").value === "existing task draft",
    );
    await page.evaluate(() => window.__draftTest.switch("/fixture-b", null));
    await page.waitForFunction(() => document.querySelector("input").value === "workspace B root");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: model change and stale accepted ACK preserve input, project/new-task scopes restore independent text/model, stale editor callbacks cannot cross scopes, 1280/375px.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
