import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__terminal-lifecycle-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>.terminal-xterm-shell{height:100%;width:100%}</style><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TerminalSession} from '../../../ui/src/terminal/TerminalSession.tsx';import {sidePaneTerminalSessionRegistry as registry} from '../../../ui/src/terminal/sidePaneTerminalSessionRegistry.ts';import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';import '@xterm/xterm/css/xterm.css';
const test:any=window.__terminalTest={created:0,killed:[],writes:[],sizes:[],deferred:false};const service={create:async()=>{const id='pty-'+(++test.created);if(test.deferred)await new Promise(r=>test.resolve=r);return {id,shell:'/bin/sh'}},dispose:async({id})=>test.killed.push(id),write:async p=>test.writes.push(p),resize:async p=>test.sizes.push(p),onDynamicData:()=>f=>{test.output=f;return {dispose(){}}},onDynamicExit:()=>()=>({dispose(){}})};
function Fixture(){const [mounted,mount]=useState(true);test.mount=mount;test.close=()=>registry.release('terminal-tab');test.lines=()=>{const t=registry.get('terminal-tab')?.term;return t?Array.from({length:t.buffer.active.length},(_,i)=>t.buffer.active.getLine(i)?.translateToString()).join('\\n'):''};return <div style={{width:'100%',height:260}}>{mounted&&<TerminalSession persistentKey="terminal-tab" workspaceKey="remote:fixture" sessionId="terminal-tab" services={{terminalService:service} as any} cwd="/fixture" isVisible onShellLabelChange={()=>{}} onOpenBrowserUrl={()=>{}}/>}</div>}
createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="en-US"><Fixture/></ZCodeIntlProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({
      viewport: { width, height: 812 },
      hasTouch: width === 375,
      isMobile: width === 375,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    await page.waitForFunction(
      () => window.__terminalTest.created === 1 && window.__terminalTest.output,
    );
    await page.locator("textarea.xterm-helper-textarea").focus();
    await page.keyboard.type("echo terminal");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__terminalTest.writes.length > 0);
    assert.equal(
      await page.evaluate(() => window.__terminalTest.writes.map((x) => x.data).join("")),
      "echo terminal\r",
    );
    await page.evaluate(() => window.__terminalTest.output("REMOTE OUTPUT\r\n"));
    await page.waitForFunction(() => window.__terminalTest.lines().includes("REMOTE OUTPUT"));
    await page.setViewportSize({ width: width === 375 ? 420 : 1024, height: 700 });
    await page.waitForFunction(() => window.__terminalTest.sizes.length > 0);
    await page.evaluate(() => window.__terminalTest.mount(false));
    await page.waitForFunction(() => !document.querySelector("#root .xterm"));
    assert.deepEqual(await page.evaluate(() => window.__terminalTest.killed), []);
    await page.evaluate(() => window.__terminalTest.mount(true));
    await page.waitForFunction(() => document.querySelector("#root .xterm"));
    assert.equal(await page.evaluate(() => window.__terminalTest.created), 1);
    await page.evaluate(() => {
      window.__terminalTest.close();
      window.__terminalTest.close();
      window.__terminalTest.mount(false);
    });
    assert.deepEqual(await page.evaluate(() => window.__terminalTest.killed), ["pty-1"]);
    await page.evaluate(() => {
      window.__terminalTest.deferred = true;
      window.__terminalTest.mount(true);
    });
    await page.waitForFunction(() => window.__terminalTest.resolve);
    await page.evaluate(() => {
      window.__terminalTest.close();
      window.__terminalTest.mount(false);
      window.__terminalTest.resolve();
    });
    await page.waitForFunction(() => window.__terminalTest.killed.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__terminalTest.killed), ["pty-1", "pty-2"]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: xterm input/resize on desktop/mobile viewport, detach/re-attach reuses PTY, explicit last-tab close kills once, late async create is disposed. Service fixture; no physical phone claim.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
