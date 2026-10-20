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
      const initial = {agent:'gemini',command:'gemini',args:['--acp'],distribution:'npm',platformSupported:true,packageName:'@google/gemini-cli',registryVersion:'0.59.0',enabled:true,env:{},source:'system',ready:true,installedVersion:'0.59.0',managedVersion:null,executablePath:'/fake/gemini',nativeCommand:'',nativePath:null,nodeVersion:'24.14.0',npmVersion:'10.33.2',nodeVersionRange:'>=20',nodeVersionCompatible:true,updateCheck:{status:'unchecked',source:'builtin',checkedAt:null}};
      const state:any = {pending:[],operations:[],calls:[],mode:'normal',environment:{},external:[],runtimePending:[],listeners:{}};
      window.__updates = state;
      state.confirmPending = () => Boolean(useConfirmDialogStore.getState().pendingRequest);
      state.confirm = () => useConfirmDialogStore.getState().settleConfirmation(true);
      const makeHost = (host:string) => ({
        async listAgents(options?:any) {
          state.calls.push({host,options});
          if (!options?.checkUpdates) return [{...initial,...state.environment,source:host==='B'?'managed':'system',managedVersion:host==='B'?'0.59.0':null,registryVersion:host==='B'?'0.62.0':'0.59.0'}];
          return new Promise(resolve=>state.pending.push({host,resolve}));
        },
        onDynamicAgentOperation(id:string){return (listener:any)=>{state.listeners[id]=listener;return {dispose(){delete state.listeners[id]}}}},
        async manageAgent(input:any){state.operations.push({host,...input});if(input.action==='install-runtime') return new Promise((resolve,reject)=>state.runtimePending.push({host,resolve,reject,...input}));return initial},
        async updateAgent(input:any){return {...initial,...input,registryVersion:'0.62.0'}},
        async listGeminiProviders(){return {version:'fake',providers:[]}},
      });
      const hosts={A:makeHost('A'),B:makeHost('B')};
      state.finish = (host:string, error=false) => {
        const item=state.pending.findIndex(x=>x.host===host);
        if(item<0) throw new Error('Missing pending Host');
        state.pending.splice(item,1)[0].resolve([{...initial,...state.environment,source:host==='B'?'managed':'system',managedVersion:host==='B'?'0.59.0':null,registryVersion:'0.62.0',updateCheck:{status:error?'error':'checked',source:'acp-registry',checkedAt:'2026-09-30T01:00:00.000Z'}}]);
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
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{openExternal:async(url)=>state.external.push(url)} as any}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ZCODE_E2E_CHROMIUM_PATH
      ? { executablePath: process.env.ZCODE_E2E_CHROMIUM_PATH }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1040, height: 840 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174"}/${name}.html`);
  await page
    .locator("#acp-env-gemini-GEMINI_MODEL")
    .waitFor({ timeout: 10000 })
    .catch((error) => {
      throw new Error(`Settings fixture failed: ${errors.join("; ") || error.message}`);
    });
  await page.waitForFunction(() => window.__updates.pending.length === 1);
  assert.equal(await page.locator("textarea").count(), 0);
  await page.locator("#acp-env-gemini-GEMINI_MODEL").fill("keep-my-draft");
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
  assert.equal(await page.locator("#acp-env-gemini-GEMINI_MODEL").inputValue(), "keep-my-draft");
  await page.evaluate(() => window.__updates.finish("A", true));
  await page.getByTestId("acp-update-check-error").waitFor();
  assert.equal(await page.locator("#acp-env-gemini-GEMINI_MODEL").inputValue(), "keep-my-draft");
  await page.locator("#acp-env-gemini-GEMINI_MODEL").fill("");
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
  assert.equal(await page.locator("#acp-env-gemini-GEMINI_MODEL").inputValue(), "");
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
  const refreshEnvironment = async (environment) => {
    await page.evaluate((value) => {
      window.__updates.environment = value;
    }, environment);
    await page.getByTestId("settings-acp-agents-refresh").click();
    await page.waitForFunction(() => window.__updates.pending.length === 1);
    await page.evaluate(() => window.__updates.finish("B"));
  };
  await refreshEnvironment({
    nodeVersion: "22.17.0",
    nodeVersionRange: ">=24.16.0 <25 || >=26.1.0",
    nodeVersionCompatible: false,
  });
  const warning = page.getByTestId("acp-node-warning");
  await warning.waitFor();
  assert.match(await warning.textContent(), /22\.17\.0/);
  assert.match(await warning.textContent(), /24\.16\.0/);
  assert.equal(await page.getByTestId("acp-upgrade").isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "卸载托管适配器", exact: true }).isEnabled(),
    true,
  );
  for (const width of [1040, 375]) {
    await page.setViewportSize({ width, height: 840 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.className =
          value === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
      }, theme);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      );
      await page
        .getByTestId("settings-acp-agent-manager")
        .screenshot({ path: `/tmp/zcode-node-check-19f9-${width}-${theme}.png` });
    }
  }
  await warning.getByRole("button", { name: "前往安装 Node.js", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__updates.external), [
    "https://nodejs.org/en/download",
  ]);
  await refreshEnvironment({
    nodeVersion: "22.17.0",
    npmVersion: "10.9.2",
    nodeVersionRange: ">=24.16 <25",
    nodeVersionCompatible: false,
    nodeInstallSupported: true,
  });
  const installRuntime = warning.getByRole("button", {
    name: "一键安装 Node.js / npm",
    exact: true,
  });
  await installRuntime.click();
  await page.waitForFunction(() => window.__updates.runtimePending.length === 1);
  assert.equal(await installRuntime.isDisabled(), true);
  assert.equal(await page.getByTestId("settings-acp-agents-refresh").isDisabled(), true);
  await page.evaluate(() => {
    const state = window.__updates;
    const input = state.runtimePending[0];
    if (input.host !== "B" || input.agent !== "gemini" || input.expectedVersion !== "0.62.0")
      throw new Error("Wrong target Host or release");
    state.listeners[input.operationId]({
      operationId: input.operationId,
      agent: input.agent,
      phase: "log",
      message: "正在下载 Node.js：50%",
    });
  });
  await page.getByRole("log").getByText("正在下载 Node.js：50%", { exact: true }).waitFor();
  await page
    .getByTestId("settings-acp-agent-manager")
    .screenshot({ path: "/tmp/zcode-node-runtime-installing-375.png" });
  await page.evaluate(() =>
    window.__updates.runtimePending.shift().reject(new Error("国内镜像下载失败，请重试")),
  );
  await page.getByText("国内镜像下载失败，请重试", { exact: true }).waitFor();
  assert.equal(await installRuntime.isEnabled(), true);
  await installRuntime.click();
  await page.waitForFunction(() => window.__updates.runtimePending.length === 1);
  await page.evaluate(() => {
    window.__updates.environment = {
      ...window.__updates.environment,
      nodeVersion: "24.19.0",
      npmVersion: "11.9.0",
      nodeVersionCompatible: true,
      nodeRuntimeSource: "managed",
    };
    window.__updates.runtimePending.shift().resolve({});
  });
  await warning.waitFor({ state: "detached" });
  assert.equal(await page.getByTestId("acp-upgrade").isEnabled(), true);
  await refreshEnvironment({
    nodeVersion: null,
    npmVersion: null,
    nodeVersionCompatible: false,
    nodeInstallSupported: true,
  });
  await installRuntime.click();
  await page.waitForFunction(() => window.__updates.runtimePending.length === 1);
  await page.evaluate(() => {
    window.__updates.switchHost("A");
  });
  await page.waitForFunction(() => window.__updates.pending.some((item) => item.host === "A"));
  await page.evaluate(() => {
    window.__updates.finish("A");
  });
  await page.evaluate(() =>
    window.__updates.runtimePending.shift().reject(new Error("旧 Host 安装失败")),
  );
  assert.equal(await page.getByText("旧 Host 安装失败", { exact: true }).count(), 0);
  await page.evaluate(() => window.__updates.switchHost("B"));
  await page.waitForFunction(() => window.__updates.pending.some((item) => item.host === "B"));
  await page.evaluate(() => window.__updates.finish("B"));
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  await refreshEnvironment({
    nodeVersion: "24.19.0",
    nodeVersionRange: ">=24.16.0 <25 || >=26.1.0",
    nodeVersionCompatible: true,
  });
  await warning.waitFor({ state: "detached" });
  assert.equal(await page.getByTestId("acp-upgrade").isEnabled(), true);
  await refreshEnvironment({ nodeVersion: null, npmVersion: null, nodeVersionCompatible: false });
  await warning.waitFor();
  assert.equal(await page.getByTestId("acp-upgrade").isDisabled(), true);
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: background update, force refresh, actions, stale Host isolation, Node requirements, legacy link, runtime install progress/failure/retry/recovery, late Host result isolation and mobile layout.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
