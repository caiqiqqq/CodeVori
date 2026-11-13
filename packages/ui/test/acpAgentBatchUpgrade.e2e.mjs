// Real management hook and controls with synthetic Hosts; no packages or credentials are touched.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-batch-e2e-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    files[1],
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AcpAgentUpgradeActions} from '../../../ui/src/settings/AcpAgentUpgradeActions.tsx';
    import {AcpAgentManagerPanel} from '../../../ui/src/settings/AcpAgentManagerPanel.tsx';
    import {acpAgentManagementSnapshotSchema} from '@zcode/shared';
    import {useAcpAgentManagement} from '../../../ui/src/settings/useAcpAgentManagement.ts';
    import {useConfirmDialogStore} from '../../../ui/src/store/confirmDialogStore.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import '../../../ui/src/styles.css';
    const initial = {command:'gemini',args:[],distribution:'npm',platformSupported:true,packageName:'fake',registryVersion:'2.0.0',enabled:true,env:{},source:'managed',ready:true,installedVersion:'1.0.0',managedVersion:'1.0.0',executablePath:'/fake/gemini',nativeCommand:'',nativePath:null,nodeVersion:'24.22.1',npmVersion:'10.9.2',nodeVersionCompatible:true,updateCheck:{status:'checked',source:'acp-registry',checkedAt:null},agentManagementSupported:true};
    const state:any = {calls:[],pending:[],listeners:{},hosts:{}};
    window.__batch=state;
    state.confirmPending=()=>Boolean(useConfirmDialogStore.getState().pendingRequest);
    state.confirm=(yes=true)=>useConfirmDialogStore.getState().settleConfirmation(yes);
    const makeHost=(host:string)=>{
      const h={agents:['gemini','cline','openclaw'].map(agent=>({...initial,agent,...(agent==='openclaw'?{source:'system',managedVersion:null}:{})})),snapshot:{ownerId:host==='A'?'123e4567-e89b-42d3-a456-426614174001':'123e4567-e89b-42d3-a456-426614174002',sequence:0,operation:null}};
      state.hosts[host]=h;
      const push=(operation:any)=>{const {expectedVersion,...snapshotOperation}=operation;h.snapshot={...h.snapshot,sequence:h.snapshot.sequence+1,operation:snapshotOperation};state.snapshotParse=acpAgentManagementSnapshotSchema.safeParse(h.snapshot);state.listeners[host]?.(structuredClone(h.snapshot))};
      return {
        async listAgents(){return structuredClone(h.agents)},
        async readAgentManagement(){return structuredClone(h.snapshot)},
        onDynamicAgentManagement(){return (listener:any)=>{state.listeners[host]=listener;return {dispose(){delete state.listeners[host]}}}},
        async manageAgent(input:any){
          state.calls.push({host,...input});
          push({...input,status:'running',busy:true,cancellable:false,log:['installing '+input.agent]});
          return new Promise((resolve,reject)=>state.pending.push({host,input,finish(success:boolean){
            if(success) h.agents=h.agents.map(item=>item.agent===input.agent?{...item,installedVersion:input.expectedVersion,managedVersion:input.expectedVersion,source:'managed'}:item);
            push({...input,status:success?'completed':'failed',busy:false,cancellable:false,log:['done']});
            if(success)resolve(h.agents.find(item=>item.agent===input.agent));else reject(new Error('synthetic upgrade failure'));
          }}));
        },
        async updateAgent(input:any){return {...initial,...input}},
        async listGeminiProviders(){return {version:'fake',providers:[]}},
      };
    };
    const hosts={A:makeHost('A'),B:makeHost('B')};
    state.finish=(success=true)=>{const item=state.pending.shift();if(!item)throw new Error('No pending operation');item.finish(success)};
    function Panel({host}:{host:'A'|'B'}){
      const management=useAcpAgentManagement(hosts[host] as any);
      state.management=management;
      return <div className="p-4 space-y-3" data-host={host}><AcpAgentUpgradeActions management={management}/><AcpAgentManagerPanel agent="gemini" service={hosts[host] as any} serviceAvailable waiting={false} management={management}/></div>;
    }
    function Fixture(){const [host,setHost]=useState<'A'|'B'>('A');state.switchHost=setHost;return <Panel key={host} host={host}/>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{openExternal:async()=>{}} as any}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
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
  const all = page.getByTestId("acp-upgrade-all");
  await all.waitFor().catch((error) => {
    throw new Error(`Batch fixture failed: ${errors.join("; ") || error.message}`);
  });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="acp-upgrade-all"]')?.disabled,
  );
  await page.locator("#acp-env-gemini-GEMINI_MODEL").fill("preserve-this-draft");
  await page.getByTestId("acp-batch-upgrade").click();
  await page.getByRole("checkbox", { name: "选择 Cline", exact: true }).click();
  await page.getByTestId("acp-upgrade-selected").click();
  await page.waitForFunction(() => window.__batch.pending.length === 1);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__batch.calls.map((x) => [x.agent, x.action, x.expectedVersion]),
    ),
    [["cline", "upgrade", "2.0.0"]],
  );
  assert.equal(await all.isDisabled(), true);
  await page.evaluate(() => window.__batch.finish());
  await page
    .getByTestId("acp-upgrade-summary")
    .getByText("成功 1，失败 0", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#acp-env-gemini-GEMINI_MODEL").inputValue(),
    "preserve-this-draft",
  );

  await page
    .waitForFunction(() => !document.querySelector('[data-testid="acp-upgrade-all"]')?.disabled, {
      timeout: 3000,
    })
    .catch(async (error) => {
      throw new Error(
        JSON.stringify(
          await page.evaluate(() => ({
            button: document.querySelector('[data-testid="acp-upgrade-all"]')?.textContent,
            agents: window.__batch.management?.agents.map((x) => [
              x.agent,
              x.installedVersion,
              x.registryVersion,
              x.updateCheck?.status,
            ]),
            busy: window.__batch.management?.busy,
            loading: window.__batch.management?.loading,
            checking: window.__batch.management?.checking,
            error: window.__batch.management?.error,
            snapshotIssues: window.__batch.snapshotParse?.success
              ? null
              : window.__batch.snapshotParse?.error?.issues,
            operation: window.__batch.management?.operation,
            batch: window.__batch.management?.batch,
            calls: window.__batch.calls.length,
          })),
        ) + `\n${error.message}`,
      );
    });
  await all.click();
  await page.waitForFunction(() => window.__batch.confirmPending());
  await page.evaluate(() => window.__batch.confirm(false));
  assert.equal(await page.evaluate(() => window.__batch.calls.length), 1);
  await all.click();
  await page.waitForFunction(() => window.__batch.confirmPending());
  await page.evaluate(() => window.__batch.confirm());
  await page.waitForFunction(() => window.__batch.pending.length === 1);
  assert.equal(
    await page.evaluate(() => window.__batch.calls.length),
    2,
    "Batch requests must be serial",
  );
  await page.evaluate(() => window.__batch.finish(false));
  await page.waitForFunction(() => window.__batch.calls.length === 3);
  assert.deepEqual(await page.evaluate(() => window.__batch.calls[2].action), "install");
  await page.evaluate(() => window.__batch.finish());
  await page
    .getByTestId("acp-upgrade-summary")
    .getByText("成功 1，失败 1", { exact: true })
    .waitFor();
  assert.match(
    await page.getByTestId("acp-upgrade-summary").textContent(),
    /synthetic upgrade failure/,
  );

  // 确认框不能在 Host 切换后启动旧目标；执行中切换也不能继续提交旧计划。
  await page.evaluate(() => window.__batch.switchHost("B"));
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="acp-upgrade-all"]')?.disabled,
  );
  await all.click();
  await page.waitForFunction(() => window.__batch.confirmPending());
  await page.evaluate(() => window.__batch.switchHost("A"));
  await page.waitForFunction(
    () => document.querySelector("[data-host]")?.getAttribute("data-host") === "A",
  );
  await page.evaluate(() => window.__batch.confirm());
  assert.equal(await page.evaluate(() => window.__batch.calls.length), 3);
  await page.evaluate(() => window.__batch.switchHost("B"));
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="acp-upgrade-all"]')?.disabled,
  );
  await all.click();
  await page.waitForFunction(() => window.__batch.confirmPending());
  await page.evaluate(() => window.__batch.confirm());
  await page.waitForFunction(() => window.__batch.calls.length === 4);
  await page.evaluate(() => window.__batch.switchHost("A"));
  await page.waitForFunction(
    () => document.querySelector("[data-host]")?.getAttribute("data-host") === "A",
  );
  await page.evaluate(() => window.__batch.finish());
  await page.waitForFunction(
    () => document.querySelector("[data-host]")?.getAttribute("data-host") === "A",
  );
  assert.equal(await page.evaluate(() => window.__batch.calls.length), 4);

  // 手机布局、全选与停止后续操作。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("acp-batch-upgrade").click();
  await page.getByRole("checkbox", { name: "全选", exact: true }).click();
  await page.getByTestId("acp-upgrade-selected").click();
  await page.waitForFunction(() => window.__batch.pending.length === 1);
  await page.getByRole("button", { name: "停止后续升级", exact: true }).click();
  await page.evaluate(() => window.__batch.finish());
  await page.getByText("已停止后续升级", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__batch.calls.length), 5);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Mobile page must not overflow",
  );
  assert.deepEqual(errors, []);
  console.log("Agent SDK batch upgrade E2E passed");
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
