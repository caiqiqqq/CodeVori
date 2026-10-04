// Synthetic Hosts and real settings hook/panel. Never installs an adapter or reads native credentials.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-updates-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {AcpAgentManagerPanel} from "../../../ui/src/settings/AcpAgentManagerPanel.tsx";
      import {useAcpAgentManagement} from "../../../ui/src/settings/useAcpAgentManagement.ts";
      import {SettingsResourceHeaderActions} from "../../../ui/src/settings/SettingsResourceHeaderActions.tsx";
      import {ZCodeIntlProvider} from "../../../ui/src/i18n/IntlProvider.tsx";
      import {TooltipProvider} from "../../../ui/src/components/ui/tooltip.tsx";
      import {PlatformProvider} from "../../../ui/src/hooks/usePlatform.tsx";
      import {useConfirmDialogStore} from "../../../ui/src/store/confirmDialogStore.ts";
      import "../../../ui/src/styles.css";
      const initial = {agent:'gemini',command:'gemini',args:['--acp'],distribution:'npm',platformSupported:true,packageName:'@google/gemini-cli',registryVersion:'0.59.0',enabled:true,env:{},source:'system',ready:true,installedVersion:'0.59.0',managedVersion:null,executablePath:'/fake/gemini',nativeCommand:'',nativePath:null,nodeVersion:'24.14.0',npmVersion:'10.33.2',updateCheck:{status:'unchecked',source:'builtin',checkedAt:null}};
      const state:any = {pending:[],operations:[],calls:[],mode:'normal'};
      window.__updates = state;
      state.confirmPending = () => Boolean(useConfirmDialogStore.getState().pendingRequest);
      state.confirm = () => useConfirmDialogStore.getState().settleConfirmation(true);
      const makeHost = (host:string) => ({
        async listAgents(options?:any) {
          state.calls.push({host,options});
          if (!options?.checkUpdates) return [{...initial,registryVersion:host==='B'?'0.62.0':'0.59.0'}];
          return new Promise(resolve=>state.pending.push({host,resolve}));
        },
        onDynamicAgentOperation(){return ()=>({dispose(){}})},
        async manageAgent(input:any){state.operations.push(input);return initial},
        async updateAgent(input:any){return {...initial,...input,registryVersion:'0.62.0'}},
        async listGeminiProviders(){return {version:'fake',providers:[]}},
      });
      const hosts={A:makeHost('A'),B:makeHost('B')};
      state.finish = (host:string, error=false) => {
        const item=state.pending.findIndex(x=>x.host===host);
        if(item<0) throw new Error('Missing pending Host');
        state.pending.splice(item,1)[0].resolve([{...initial,source:host==='B'?'managed':'system',managedVersion:host==='B'?'0.59.0':null,registryVersion:'0.62.0',updateCheck:{status:error?'error':'checked',source:'acp-registry',checkedAt:'2026-09-30T01:00:00.000Z'}}]);
      };
      function Fixture(){
        const [host,setHost]=useState<'A'|'B'>('A');
        state.switchHost=setHost;
        return <Panel key={host} host={host}/>;
      }
      function Panel({host}:{host:'A'|'B'}){
        const management=useAcpAgentManagement(hosts[host] as any);
        return <div data-host={host}><SettingsResourceHeaderActions
          onRefresh={()=>void management.refresh()} refreshing={management.checking || management.loading}
          refreshDisabled={management.busy} refreshLabel="检查更新" refreshTestId="settings-acp-agents-refresh"
        /><AcpAgentManagerPanel agent="gemini" service={hosts[host] as any} serviceAvailable waiting={false} management={management}/></div>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{} as any}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1040, height: 840 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:5174/${name}.html`);
  await page
    .locator("#acp-env-raw-gemini")
    .waitFor({ timeout: 10000 })
    .catch((error) => {
      throw new Error(`Settings fixture failed: ${errors.join("; ") || error.message}`);
    });
  await page.waitForFunction(() => window.__updates.pending.length === 1);
  await page.locator("#acp-env-raw-gemini").fill("EXTRA=keep-my-draft");
  await page.evaluate(() => window.__updates.finish("A"));
  await page.getByTestId("acp-update-available").waitFor();
  assert.match(await page.getByTestId("acp-update-available").textContent(), /0\.62\.0/);
  const install = page.getByTestId("acp-install");
  assert.equal(
    await install.isDisabled(),
    true,
    "Unsaved environment must be preserved and block installation",
  );
  await page.getByTestId("settings-acp-agents-refresh").click();
  await page.waitForFunction(() => window.__updates.pending.length === 1);
  assert.equal(await page.locator("#acp-env-raw-gemini").inputValue(), "EXTRA=keep-my-draft");
  await page.evaluate(() => window.__updates.finish("A", true));
  await page.getByTestId("acp-update-check-error").waitFor();
  assert.equal(await page.locator("#acp-env-raw-gemini").inputValue(), "EXTRA=keep-my-draft");
  await page.locator("#acp-env-raw-gemini").fill("");
  await install.click();
  await page.waitForFunction(() => window.__updates.confirmPending());
  await page.getByTestId("settings-acp-agents-refresh").click();
  await page.waitForFunction(() => window.__updates.pending.length === 1);
  await page.evaluate(() => window.__updates.switchHost("B"));
  await page.waitForFunction(() => window.__updates.pending.length === 2);
  await page.evaluate(() => window.__updates.finish("B"));
  await page.getByTestId("acp-upgrade").waitFor();
  await page.evaluate(() => window.__updates.finish("A"));
  await page.evaluate(() => window.__updates.confirm());
  assert.equal(
    await page.evaluate(() => window.__updates.operations.length),
    0,
    "Confirmation after leaving Host must not install on the old Host",
  );
  assert.equal(await page.locator("[data-host]").getAttribute("data-host"), "B");
  assert.equal(await page.locator("#acp-env-raw-gemini").inputValue(), "");
  assert.equal(await page.getByTestId("acp-install").count(), 0);
  await page.getByTestId("acp-upgrade").click();
  await page.waitForFunction(() => window.__updates.operations.length === 1);
  assert.equal(await page.evaluate(() => window.__updates.operations[0].expectedVersion), "0.62.0");
  await page.getByTestId("settings-acp-agents-refresh").click();
  await page.waitForFunction(() => window.__updates.pending.length === 1);
  const enabled = page.getByRole("switch", { name: "启用智能体", exact: true });
  await enabled.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="启用智能体"]')?.getAttribute("aria-checked") === "false",
  );
  await page.evaluate(() => window.__updates.finish("B"));
  assert.equal(
    await enabled.getAttribute("aria-checked"),
    "false",
    "Old checks cannot overwrite a completed settings save",
  );
  assert.ok(await page.evaluate(() => window.__updates.calls.some((x) => x.options?.force)));
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: background update, force refresh, system/managed actions, exact version, draft preservation and stale Host isolation.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
