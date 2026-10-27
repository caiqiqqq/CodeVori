import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__tab-persistence-${process.pid}`;
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
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
import {useTabPersistence} from '../../../ui/src/hooks/useTabPersistence.ts';
const params=new URLSearchParams(location.search); const mode=params.get('mode');
let release; let calls=0; let writes=0; let reads=0; let lastStore;
const service={get:async()=>{calls++;if(mode==='slow')await new Promise(r=>release=r);if(mode==='failure')throw Error('fixture read failure');reads++;return JSON.parse(localStorage.getItem('fixture-settings')||'{}')},update:async patch=>{writes++;localStorage.setItem('fixture-settings',JSON.stringify({...JSON.parse(localStorage.getItem('fixture-settings')||'{}'),...patch}));}};
function Session(){const store=useTabStoreApi();lastStore=store;const tabs=useTabStore(s=>s.tabs);const status=useTabPersistence({settingService:service as never,restoreSession:mode!=='secondary',persistSession:mode!=='secondary'});return <><output data-ready={status.hasCompletedFullRestore}>{tabs.map(t=>t.kind==='workspace'?t.workspacePath:'').join(',')}</output><button onClick={()=>store.getState().addTab('/new')}>Open new</button><button onClick={()=>{const id=store.getState().tabs.find(t=>t.kind==='workspace'&&t.workspacePath==='/close')?.id;if(id)store.getState().closeTab(id)}}>Close workspace</button><button onClick={()=>{store.getState().addTab('/new');window.fixture.unmount()}}>Open and unmount</button><button onClick={()=>{const id=store.getState().tabs.find(t=>t.kind==='workspace'&&t.workspacePath==='/close')?.id;if(id)store.getState().closeTab(id);window.fixture.unmount()}}>Close and unmount</button></>}
function Fixture(){const [mounted,setMounted]=useState(true);window.fixture={unmount:()=>setMounted(false),stats:()=>({calls,writes,reads,tabs:lastStore?.getState().tabs.map(t=>t.workspacePath)}),release:()=>release?.()};return <><button onClick={()=>setMounted(v=>!v)}>Toggle</button><TabStoreProvider>{mounted?<Session/>:<p>Unmounted</p>}</TabStoreProvider></>};createRoot(document.getElementById('root')!).render(<Fixture/>);
`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  const base = `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193"}/${name}.html`;
  const seed = {
    lastWorkspaceSession: [
      { kind: "local", workspacePath: "/close" },
      { kind: "local", workspacePath: "/keep" },
    ],
    recentProjects: ["/close", "/keep"],
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("fixture-settings")));
  const paths = (settings) => settings.lastWorkspaceSession.map((entry) => entry.workspacePath);
  async function open(mode = "") {
    await page.goto(base);
    await page.evaluate(
      (settings) => localStorage.setItem("fixture-settings", JSON.stringify(settings)),
      seed,
    );
    await page.goto(`${base}?mode=${mode}`);
    if (mode !== "slow")
      await page.locator('output[data-ready="true"]').waitFor({ state: "attached" });
    else await page.getByRole("button", { name: "Toggle", exact: true }).waitFor();
  }
  await open();
  await page.getByRole("button", { name: "Close workspace", exact: true }).click();
  assert.deepEqual(paths(await read()), ["/keep"], "local close must persist before debounce");
  await open();
  await page.getByRole("button", { name: "Close and unmount", exact: true }).click();
  await page.getByText("Unmounted", { exact: true }).waitFor();
  assert.deepEqual(paths(await read()), ["/keep"], "close intent must survive immediate unmount");
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  await page.locator('output[data-ready="true"]').waitFor();
  assert.equal(
    await page.locator("output").textContent(),
    "/keep",
    "closed tab must not reappear on restore",
  );
  await open();
  await page.getByRole("button", { name: "Open and unmount", exact: true }).click();
  await page.getByText("Unmounted", { exact: true }).waitFor();
  assert.ok(paths(await read()).includes("/new"), "unmount must flush latest pending projection");
  await open("failure");
  await page.getByRole("button", { name: "Open and unmount", exact: true }).click();
  await page.getByText("Unmounted", { exact: true }).waitFor();
  assert.deepEqual(await read(), seed, "failed restore must preserve disk snapshot");
  assert.equal(await page.evaluate(() => window.fixture.stats().writes), 0);
  await open("secondary");
  await page.getByRole("button", { name: "Open and unmount", exact: true }).click();
  assert.deepEqual(await read(), seed, "secondary window cannot replace primary snapshot");
  await open("slow");
  await page.waitForFunction(() => window.fixture.stats().calls === 1);
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  await page.getByText("Unmounted", { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.release());
  await page.waitForFunction(() => window.fixture.stats().reads === 1);
  assert.equal(
    await page.evaluate(() => window.fixture.stats().writes),
    0,
    "cancelled restore cannot write recents",
  );
  assert.deepEqual(
    await page.evaluate(() => window.fixture.stats().tabs),
    [],
    "cancelled restore cannot repopulate tabs",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: close/reopen, pending unmount flush, failed/cancelled restore, secondary window isolation",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
