// Run with the desktop Vite server on ZCODE_E2E_BASE_URL (default port 5187).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__conversation-resize-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "conversation-resize-e2e-"));
let browser;

try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
import '../../../ui/src/styles.css';
const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
const context={workspacePath:'/fixture/resize',theme:'zai-light',
  codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture'};
const entries=Array.from({length:90},(_,index)=>[
  {id:'user:'+index,kind:'user',text:'Question '+index},
  {id:'assistant:'+index,kind:'assistant',text:Array.from({length:16},(_,line)=>
    'Paragraph '+index+' / '+line+' with text that wraps when the conversation narrows.').join('\\n\\n')}
]).flat();
const rows=buildAcpConversationRows({entries,status:'idle'});
createRoot(document.getElementById('root')!).render(
  <PlatformProvider platform={platform as never}><TabStoreProvider>
    <ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN">
      <TooltipProvider><div className="h-screen flex flex-col bg-background text-foreground" data-ready="true">
        <ConversationTimeline sessionKey="resize-fixture" rows={rows} totalCount={rows.length}
          rowContext={context} hideTurnNavigator bottomDock={<textarea defaultValue="draft"/>}/>
      </div></TooltipProvider>
    </ZCodeIntlProvider></ServiceProvider>
  </TabStoreProvider></PlatformProvider>
);
`,
  );

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187"}/${name}.html`);
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator("[data-v4-timeline-scroll]").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const distanceSamples = await page.evaluate(async () => {
    const scroll = document.querySelector("[data-v4-timeline-scroll]");
    const values = [];
    let recording = true;
    const sample = () => {
      if (!recording) return;
      values.push(Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__stopResizeSampling = () => {
      recording = false;
      return values;
    };
    return values.length;
  });
  assert.equal(distanceSamples, 0);
  await page.setViewportSize({ width: 660, height: 900 });
  await page.waitForTimeout(350);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(350);
  const distances = await page.evaluate(() => window.__stopResizeSampling());
  const maxDistance = Math.max(...distances);
  await page.locator("[data-v4-timeline-scroll]").evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
    element.scrollTop = element.scrollHeight * 0.5;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(300);
  const visibleTurn = () =>
    page.evaluate(() => {
      const viewport = document.querySelector("[data-v4-timeline-scroll]").getBoundingClientRect();
      const row = [...document.querySelectorAll("[data-v4-turn-unit]")].find(
        (element) => element.getBoundingClientRect().bottom > viewport.top + 20,
      );
      return row?.getAttribute("data-turn-id") ?? null;
    });
  const beforeTurn = await visibleTurn();
  assert.ok(beforeTurn, "A history turn must be visible before resizing");
  await page.setViewportSize({ width: 660, height: 900 });
  await page.waitForTimeout(350);
  const narrowTurn = await visibleTurn();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(350);
  const restoredTurn = await visibleTurn();
  await page.screenshot({ path: join(artifacts, "resize.png") });
  assert.deepEqual(errors, []);
  assert.ok(maxDistance <= 4, `Following conversation detached during resize: ${maxDistance}px`);
  assert.equal(narrowTurn, beforeTurn, "Narrowing keeps the visible history turn");
  assert.equal(restoredTurn, beforeTurn, "Restoring width keeps the visible history turn");
  console.log(
    `PASS: ${distances.length} frames, maximum bottom gap ${maxDistance}px; visible turn ${beforeTurn}. ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
