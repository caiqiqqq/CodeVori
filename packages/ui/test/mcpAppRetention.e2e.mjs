import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__mcp-retention-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
const html = `<button id="counter">0</button><script>let n=0;document.querySelector('button').onclick=()=>document.querySelector('button').textContent=++n;parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize'},'*');addEventListener('message',e=>{if(e.data.id===1){document.body.dataset.ready='true';parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')}});</script>`;
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
import {McpAppFrame} from '../../../ui/src/ToolCallBlocks/McpAppFrame.tsx';
import {McpAppScopeContext,clearMcpAppPages} from '../../../ui/src/ToolCallBlocks/mcpAppPages.ts';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
const output={_meta:{'zcode/mcpApp':{resourceUri:'ui://fixture/panel',html:${JSON.stringify(html)},connectDomains:[],resourceDomains:[]}}};
function Fixture(){const [scope,setScope]=useState('A'),[show,setShow]=useState(true),[dual,setDual]=useState(false),[capacity,setCapacity]=useState(false);return <ZCodeIntlProvider initialLocale="zh-CN">{['A','B','remote-A'].map(s=><button key={s} onClick={()=>setScope(s)}>{s}</button>)}<button onClick={()=>setShow(!show)}>Toggle</button><button onClick={()=>{setShow(false);clearMcpAppPages()}}>Clear</button><button onClick={()=>setDual(!dual)}>Dual</button><button onClick={()=>{setShow(false);clearMcpAppPages();setCapacity(true)}}>Capacity</button>{capacity&&<McpAppScopeContext.Provider value="capacity">{Array.from({length:65},(_,i)=><McpAppFrame key={i} instanceId={String(i)} output={output} input={{}}/>)}</McpAppScopeContext.Provider>}{show&&<McpAppScopeContext.Provider value={scope}><div data-visible-app><McpAppFrame instanceId="same-call" output={output} input={{}}/>{dual&&<McpAppFrame instanceId="same-call" output={output} input={{}}/>}</div></McpAppScopeContext.Provider>}</ZCodeIntlProvider>};createRoot(document.getElementById('root')!).render(<Fixture/>);`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  const base = `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`;
  await page.goto(base);
  const button = (n) => page.getByRole("button", { name: n, exact: true });
  const frame = () => page.frameLocator("[data-visible-app] iframe").first();
  const ready = () => frame().locator('body[data-ready="true"]').waitFor();
  await ready();
  await frame().locator("#counter").click();
  assert.equal(await frame().locator("#counter").innerText(), "1");
  await button("B").click();
  await ready();
  assert.equal(await frame().locator("#counter").innerText(), "0");
  await frame().locator("#counter").click();
  await frame().locator("#counter").click();
  await button("A").click();
  await ready();
  assert.equal(await frame().locator("#counter").innerText(), "1");
  await button("remote-A").click();
  await ready();
  assert.equal(await frame().locator("#counter").innerText(), "0");
  await button("A").click();
  await ready();
  assert.equal(await frame().locator("#counter").innerText(), "1");
  await button("Toggle").click();
  assert.equal(await page.locator("[data-mcp-app-parking] iframe").count(), 3);
  await page.clock.runFor(299_000);
  assert.ok((await page.locator("iframe").count()) >= 1);
  await page.clock.runFor(2_000);
  assert.equal(await page.locator("iframe").count(), 0);
  await button("Toggle").click();
  await ready();
  assert.equal(await frame().locator("#counter").innerText(), "0");
  await frame().locator("#counter").click();
  await button("Dual").click();
  await page
    .frameLocator("[data-visible-app] iframe")
    .nth(1)
    .locator('body[data-ready="true"]')
    .waitFor();
  assert.equal(await frame().locator("#counter").innerText(), "1");
  await button("Dual").click();
  assert.equal(await page.locator("[data-visible-app] iframe").count(), 1);
  const other = await browser.newPage();
  await other.goto(base);
  await other.frameLocator("iframe").locator('body[data-ready="true"]').waitFor();
  assert.equal(await other.frameLocator("iframe").locator("#counter").innerText(), "0");
  await other.close();
  await button("Clear").click();
  assert.equal(await page.locator("iframe").count(), 0);
  await button("Capacity").click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("iframe").count(), 64);
  assert.deepEqual(errors, []);
  console.log(
    "PASS retained iframe state, session/remote/window isolation, duplicate presenters, five-minute expiration and recreation, unload cleanup",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
