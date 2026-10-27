import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__composer-ime-scope-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ConversationComposer} from '../../../ui/src/v4/ConversationComposer.tsx';import {useDraftConfigControl} from '../../../ui/src/v4/composer/useDraftConfigControl.ts';import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
const dispose=()=>({dispose(){}});const services:any={settingService:{get:async()=>({})},broadcastService:{onMessage:dispose,send:async()=>{}},fileService:{},promptAttachmentTransferService:{},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})}};const noop=()=>{};
function Fixture(){const [scope,setScope]=useState('task-a');const c=useDraftConfigControl({workspacePath:'/fixture',sessionId:scope,modelSelectionService:null,agentStartupAllowed:false});const test:any=window.__scopeTest??={};test.switch=setScope;test.draft=c.composerDraft;return <ConversationComposer {...({snapshot:null,sessionId:scope,workspacePath:'/fixture',composerDraft:c.composerDraft,updateComposerContent:c.updateComposerContent,replaceComposerDraft:c.replaceComposerDraft,draftConfig:c.draftConfig,attachmentPut:async()=>{throw Error('unused')},onSendText:async()=>{},onStop:noop,onSelectModel:noop,onSelectThought:noop,onSwitchMode:noop,listenAddToChatEvents:false,autoFocusEnabled:false} as any)}/>}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{onSettingsChanged:()=>()=>{},isDesktop:false} as any}><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="en-US"><TabStoreProvider><TooltipProvider><Fixture/></TooltipProvider></TabStoreProvider></ZCodeIntlProvider></ServiceProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error(e.stack);
    });
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    await page.locator('[data-e2e-lexical-bridge="ready"]').waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => {
      const input = document.querySelector('[data-e2e-lexical-bridge="ready"]');
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.__zcodeLexicalInputE2E.setText("未上屏草稿A");
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.evaluate(() => window.__scopeTest.draft.text), "");
    await page.evaluate(() => window.__scopeTest.switch("task-b"));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-e2e-lexical-bridge="ready"]')
          .__zcodeLexicalInputE2E.getText() === "",
    );
    await page.evaluate(() =>
      document
        .querySelector('[data-e2e-lexical-bridge="ready"]')
        .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => window.__scopeTest.switch("task-a"));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-e2e-lexical-bridge="ready"]')
          .__zcodeLexicalInputE2E.getText() === "未上屏草稿A",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: real ConversationComposer saves unpublished IME draft to outgoing task and restores it after switching back, 1280/375px.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
