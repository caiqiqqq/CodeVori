// Run against the desktop Vite server; no external MCP or credentials are used.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__mcp-app-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
const artifacts = await mkdtemp(join(tmpdir(), "mcp-app-e2e-"));
let browser;
const appHtml = `<button id="count">0</button><pre id="result"></pre><script>
let count=0;document.querySelector('#count').onclick=()=>document.querySelector('#count').textContent=String(++count);
let isolated=false;try{parent.document.body}catch{isolated=true}
window.addEventListener('message',e=>{const m=e.data;
 if(m.id===1&&m.result){document.body.dataset.isolated=String(isolated);document.body.dataset.ack='true'}
 if(m.method==='ui/notifications/tool-result')document.querySelector('#result').textContent=JSON.stringify(m.params);
 if(m.id===2)document.body.dataset.ping=JSON.stringify(m.result);
 if(m.id===3)document.body.dataset.unsupported=String(m.error?.code);
});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{}},'*');
fetch('https://blocked.invalid/mcp-app').catch(()=>document.body.dataset.blocked='true');
window.ping=()=>parent.postMessage({jsonrpc:'2.0',id:2,method:'ping'},'*');
window.ready=()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
window.unsupported=()=>parent.postMessage({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'Bash'}},'*');
window.resize=()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:99999}},'*');
window.link=()=>parent.postMessage({jsonrpc:'2.0',id:4,method:'ui/open-link',params:{url:'https://example.org/demo'}},'*');
</script>`;
try {
  await writeFile(
    files[0],
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    files[1],
    `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {McpToolCallBlock} from '../../../ui/src/ToolCallBlocks/renderers/mcp.tsx';
import {toolCallRowToLegacyNode} from '../../../ui/src/v4/toolCallRowAdapter.ts';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import '../../../ui/src/styles.css';
const app={resourceUri:'ui://fixture/app',html:${JSON.stringify(appHtml)},connectDomains:[],resourceDomains:[]};
function Fixture(){const [n,setN]=useState(1);const [show,setShow]=useState(true);return <ZCodeIntlProvider initialLocale="zh-CN"><main className="min-h-screen bg-background text-foreground"><button onClick={()=>setN(n+1)}>Update</button><button onClick={()=>setShow(!show)}>Toggle</button>{show&&<TooltipProvider><McpToolCallBlock theme="zai-light" statusLabel="Completed" toolCallNode={toolCallRowToLegacyNode({rowId:1,turnId:'turn',createdAt:1,createdAtSeq:1,kind:'toolCall',inputText:'{}',toolCallId:'fixture-call',toolName:'mcp__fixture__app',status:'success',input:{n},output:{text:'result-'+n,display:{kind:'mcp_tool',serverName:'fixture',toolName:'app',app:{resource:app,result:{content:[{type:'text',text:'result-'+n}]}}}}} as never)}/></TooltipProvider>}</main></ZCodeIntlProvider>};
createRoot(document.getElementById('root')!).render(<Fixture/>);`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(r.status(), r.url());
  });
  const blocked = [];
  page.on("request", (r) => {
    if (r.url().includes("blocked.invalid")) blocked.push(r.url());
  });
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187"}/${name}.html`);
  const frame = page.frameLocator("iframe");
  try {
    await frame.locator('body[data-ack="true"]').waitFor({ timeout: 10000 });
    // App 尚未 initialized 时更新结果；不得提前通知或重新挂载 iframe。
    await page.getByText("Update", { exact: true }).click();
    assert.equal(await frame.locator("#result").innerText(), "");
    await frame.locator("body").evaluate(() => window.ready());
    await frame.locator("#result").filter({ hasText: "result-2" }).waitFor({ timeout: 10000 });
  } catch (e) {
    console.log(errors);
    console.log(await page.locator("body").innerText());
    console.log(
      await page.evaluate(
        () => document.querySelector("vite-error-overlay")?.shadowRoot?.textContent,
      ),
    );
    await page.screenshot({ path: join(artifacts, "failure.png") });
    throw e;
  }
  assert.equal(await frame.locator("body").getAttribute("data-isolated"), "true");
  await frame.locator('body[data-blocked="true"]').waitFor();
  assert.deepEqual(blocked, []);
  await frame.locator("#count").click();
  assert.equal(await frame.locator("#count").innerText(), "1");
  await page.getByText("Update", { exact: true }).click();
  await frame.locator("#result").filter({ hasText: "result-3" }).waitFor();
  assert.equal(
    await frame.locator("#count").innerText(),
    "1",
    "result projection must preserve the running App",
  );
  await frame.locator("body").evaluate(() => window.ping());
  await frame.locator('body[data-ping="{}"]').waitFor();
  await frame.locator("body").evaluate(() => window.unsupported());
  await frame.locator('body[data-unsupported="-32601"]').waitFor();
  await page.evaluate(() =>
    window.postMessage(
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 700 } },
      "*",
    ),
  );
  assert.equal(await page.locator("iframe").evaluate((e) => e.style.height), "320px");
  await frame.locator("body").evaluate(() => window.resize());
  await page.waitForFunction(() => document.querySelector("iframe").style.height === "900px");
  await frame.locator("body").evaluate(() => window.link());
  await page.getByRole("link").waitFor();
  assert.equal(await page.getByRole("link").getAttribute("href"), "https://example.org/demo");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const appFrame = await (await page.locator("iframe").elementHandle()).contentFrame();
  await appFrame.waitForFunction(
    () => getComputedStyle(document.documentElement).colorScheme === "dark",
    null,
    { timeout: 5000 },
  );
  assert.equal(
    await frame.locator("html").evaluate((e) => getComputedStyle(e).colorScheme),
    "dark",
  );
  assert.equal(await frame.locator("#count").innerText(), "1", "theme changes preserve App state");
  await page.screenshot({ path: join(artifacts, "mobile-dark.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await appFrame.waitForFunction(
    () => getComputedStyle(document.documentElement).colorScheme === "light",
    null,
    { timeout: 5000 },
  );
  assert.equal(await frame.locator("#count").innerText(), "1");
  await page.getByText("Toggle", { exact: true }).click();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.getByText("Toggle", { exact: true }).click();
  await frame.locator('body[data-ack="true"]').waitFor();
  await frame.locator("body").evaluate(() => window.ready());
  await frame.locator("#result").filter({ hasText: "result-3" }).waitFor();
  assert.equal(await frame.locator("#count").innerText(), "0");
  assert.deepEqual(errors, []);
  console.log(
    `PASS MCP App initialization, update, interaction, CSP, isolation, unsupported methods, resize and remount. ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
