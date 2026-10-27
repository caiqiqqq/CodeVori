import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__composition-parity-${process.pid}`;
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
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';
import {LexicalChatInput} from '../../../ui/src/LexicalChatInput.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
const services:any={settingService:{get:async()=>({})},broadcastService:{onMessage:()=>({dispose(){}})}};
function Fixture(){const api=useRef(null); const test:any=window.__compositionTest??={changes:[]};test.api=api;
return <LexicalChatInput workspacePath="/fixture" taskId={null} inputTestId="editor" editorApiRef={api} enableMentionPanel={false} enableSlashCommands={false} onChange={text=>test.changes.push(text)} onSubmit={()=>false}/>;}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><TabStoreProvider><Fixture/></TabStoreProvider></ServiceProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    await page.waitForFunction(() => window.__compositionTest?.api.current);
    await page.evaluate(() => {
      window.__compositionTest.changes = [];
      document
        .querySelector('[data-testid="editor"]')
        .dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    for (const text of ["拼", "拼音", "拼音草稿"]) {
      await page.evaluate((text) => window.__compositionTest.api.current.setText(text), text);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    assert.deepEqual(
      await page.evaluate(() => window.__compositionTest.changes),
      [],
      "composition updates must not serialize/publish on every keystroke",
    );
    assert.equal(
      await page.evaluate(() => window.__compositionTest.api.current.getMarkdown()),
      "拼音草稿",
      "scope snapshot must read unpublished editor state",
    );
    await page.evaluate(() =>
      document
        .querySelector('[data-testid="editor"]')
        .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "拼音草稿" })),
    );
    await page.waitForFunction(() => window.__compositionTest.changes.at(-1) === "拼音草稿");
    assert.deepEqual(await page.evaluate(() => window.__compositionTest.changes), ["拼音草稿"]);
    const longText = "long text 中文 ".repeat(4000);
    await page.evaluate((text) => window.__compositionTest.api.current.setText(text), longText);
    await page.waitForFunction(
      (length) => window.__compositionTest.changes.at(-1)?.length === length,
      longText.length,
    );
    const editor = page.getByTestId("editor");
    await editor.press("End");
    await page.keyboard.type("x");
    await page.waitForFunction(
      (length) => window.__compositionTest.changes.at(-1)?.length === length,
      longText.length + 1,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: real Lexical IME postpones publication, live draft remains readable, final composition publishes once, 52k long text accepts typing, desktop/mobile widths.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
