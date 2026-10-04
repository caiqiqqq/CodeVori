// Provider icons read the owning Host; fake services never connect models or touch history.
// node packages/ui/test/apiProviderIconHosts.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__api-provider-icon-hosts-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TaskAgentIcon} from '../../../ui/src/components/TaskAgentIcon.tsx';
    import {ProviderLogo} from '../../../ui/src/settings/model-provider-section/ProviderLogo.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {connectProviderSettingsSnapshot} from '../../../ui/src/lib/providerSettingsSnapshot.ts';
    import '../../../ui/src/styles.css';
    const state={reads:[]}; window.__providerHosts=state;
    const view=(key,revision=1)=>({revision,providers:[{providerId:'bigmodel-api',enabled:false,effectiveConfig:{logo:{type:'builtin',key}},models:[],issues:[]}],providerOrder:[],providerTemplates:[]});
    let finishOld;
    const pending=new Promise(resolve=>{finishOld=resolve;});
    const services=(id,getView)=>{
      const listeners=new Set();
      const providerSettingsService={getView:async()=>{state.reads.push(id);return getView();},onDidChange:callback=>{listeners.add(callback);return {dispose(){listeners.delete(callback)}}}};
      return {providerSettingsService,emit(value){for(const callback of listeners)callback(value)}};
    };
    const local=services('local',()=>view('bigmodel'));
    const oldA=services('old-a',()=>pending);
    const newA=services('new-a',()=>view('openai'));
    const hostB=services('host-b',()=>view('deepseek'));
    const failed=services('failed',()=>Promise.reject(new Error('fixture read failed')));
    connectProviderSettingsSnapshot(local.providerSettingsService);
    const store=useRemoteWorkspaceSessionStore.getState();
    store.registerBaseServices(local);
    store.registerSession({sessionId:'a',services:oldA});
    store.registerSession({sessionId:'b',services:hostB});
    store.registerSession({sessionId:'failed',services:failed});
    store.bindWorkspaceIdentity('fixture-host-a','a');
    store.bindWorkspaceIdentity('fixture-host-b','b');
    store.bindWorkspaceIdentity('fixture-host-failed','failed');
    state.switchHost=()=>store.registerSession({sessionId:'a',services:newA});
    state.finishOld=()=>finishOld(view('anthropic',99));
    state.updateB=()=>hostB.emit(view('anthropic',2));
    state.staleB=()=>hostB.emit(view('deepseek',1));
    state.disconnectB=()=>store.unregisterSession('b');
    const scopes=[['local',undefined],['a','fixture-host-a'],['b','fixture-host-b'],['failed','fixture-host-failed'],['waiting','fixture-host-waiting']];
    createRoot(document.getElementById('root')).render(<TabStoreProvider><ServiceProvider services={local}>
      <aside>{['bigmodel','openai','deepseek','anthropic'].map(key=><span key={key} data-testid={'reference-'+key}><ProviderLogo logo={{type:'builtin',key}} className="size-4"/></span>)}</aside>
      <main>{scopes.map(([id,workspaceIdentity])=><div key={id} data-testid={'provider-'+id}>
        <TaskAgentIcon task={{workspacePath:'/fixture/same-path',workspaceIdentity,model:'bigmodel-api/GLM-5'}}/>
      </div>)}</main>
    </ServiceProvider></TabStoreProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${name}.html`);
  const row = (id) => page.getByTestId(`provider-${id}`);
  const image = (id) => row(id).locator("img");
  const referenceSource = (key) =>
    page.getByTestId(`reference-${key}`).locator("img").getAttribute("src");
  async function waitForLogo(id, key) {
    const source = await referenceSource(key);
    await page.waitForFunction(
      ({ id, source }) =>
        document.querySelector(`[data-testid="provider-${id}"] img`)?.getAttribute("src") ===
        source,
      { id, source },
    );
  }
  await waitForLogo("local", "bigmodel");
  await waitForLogo("b", "deepseek");
  for (const id of ["a", "failed", "waiting"]) {
    await row(id).locator("svg.lucide-package").waitFor();
    assert.equal(await image(id).count(), 0, "Remote pending/failure never borrows local logo");
  }
  await page.evaluate(() => window.__providerHosts.switchHost());
  await waitForLogo("a", "openai");
  await page.evaluate(async () => {
    window.__providerHosts.finishOld();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.match(await image("a").getAttribute("src"), /openai/, "Late old Host response is ignored");
  await page.evaluate(() => window.__providerHosts.updateB());
  await waitForLogo("b", "anthropic");
  await page.evaluate(() => window.__providerHosts.staleB());
  assert.match(await image("b").getAttribute("src"), /anthropic/, "Older revisions are ignored");
  assert.equal(
    await image("local").getAttribute("src"),
    await referenceSource("bigmodel"),
    "Remote updates leave local identity unchanged",
  );
  await page.evaluate(() => window.__providerHosts.disconnectB());
  await row("b").locator("svg.lucide-package").waitFor();
  assert.equal(
    await image("b").count(),
    0,
    "Disconnected Host does not fall back to local settings",
  );
  assert.deepEqual((await page.evaluate(() => window.__providerHosts.reads)).sort(), [
    "failed",
    "host-b",
    "local",
    "new-a",
    "old-a",
  ]);
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: provider icon Host/identity isolation, pending/failure fallback, configuration updates, stale revision/old Host guards and disconnect.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
