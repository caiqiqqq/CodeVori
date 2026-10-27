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
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Terminal} from '../../../ui/src/Terminal.tsx';import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';import {sidePaneTerminalSessionRegistry as registry} from '../../../ui/src/terminal/sidePaneTerminalSessionRegistry.ts';import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';import '@xterm/xterm/css/xterm.css';
const test:any=window.__terminalTest={created:0,killed:[],writes:[],sizes:[],deferred:false};const service={create:async()=>{const id='pty-'+(++test.created);if(test.deferred)await new Promise(r=>test.resolve=r);return {id,shell:'/bin/sh'}},dispose:async({id})=>test.killed.push(id),write:async p=>test.writes.push(p),resize:async p=>test.sizes.push(p),onDynamicData:()=>f=>{test.output=f;return {dispose(){}}},onDynamicExit:()=>()=>({dispose(){}})};
const services:any={terminalService:service,settingService:{get:async()=>({})},broadcastService:{onMessage:()=>({dispose(){}})}};
function Fixture(){const [visible,setVisible]=useState(true);test.open=()=>setVisible(true);return <div style={{width:'100%',height:300,display:visible?'block':'none'}}><Terminal services={services} cwd="/fixture" isVisible={visible} onClose={()=>setVisible(false)} onOpenBrowserUrl={()=>{}}/></div>}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><ZCodeIntlProvider initialLocale="en-US"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></PlatformProvider>);

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
    const closeTab = page.getByRole("button", { name: /^Close fixture$/i });
    await closeTab.click();
    await page.waitForFunction(() => window.__terminalTest.killed.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__terminalTest.killed), ["pty-1"]);
    await page.evaluate(() => window.__terminalTest.open());
    await page.waitForFunction(() => window.__terminalTest.created === 2);
    await closeTab.click();
    await page.waitForFunction(() => window.__terminalTest.killed.length === 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: bottom Terminal last-tab button kills PTY and reopening creates a new process, desktop/mobile widths.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
