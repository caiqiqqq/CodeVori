// Real settings panel with a synthetic Host; no native credentials or model requests.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-fields-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {ACP_AGENT_CATALOG,ACP_AGENT_MODEL_ENV} from '@zcode/shared';
    import {createRoot} from 'react-dom/client';
    import {AcpAgentManagerPanel} from '../../../ui/src/settings/AcpAgentManagerPanel.tsx';
    import {useAcpAgentManagement} from '../../../ui/src/settings/useAcpAgentManagement.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import '../../../ui/src/styles.css';
    const base = {command:'fake',args:[],distribution:'npm',enabled:true,source:'system',ready:true,installedVersion:'1.0.0',registryVersion:'1.0.0',managedVersion:null,executablePath:'/fake/agent',nodeVersion:'24.14.0',npmVersion:'10.33.2',defaultModel:'',defaultModelSupported:true,updateCheck:{status:'unavailable',source:'builtin',checkedAt:null}};
    const agents = ACP_AGENT_CATALOG.map(({id:agent})=>({...base,agent,env: agent==='claude'?{ANTHROPIC_AUTH_TOKEN:'fake-token',ANTHROPIC_MODEL:'original',EXTRA:'keep-existing'}:{EXTRA:'keep-existing'}}));
    const state:any = {saves:[],modelMode:'normal',modelCalls:0}; window.__fields=state;
    const service:any = {
      async listAgents(){return agents.map(a=>({...a,defaultModelSupported:!state.oldHost,env:{...a.env}}))},
      async updateAgent(input:any){state.saves.push(input);const a=agents.find(a=>a.agent===input.agent)!;Object.assign(a,input);return {...a}},
      onDynamicAgentOperation(){return ()=>({dispose(){}})},
      async listGeminiProviders(){return {version:'fake',providers:[{id:'123e4567-e89b-42d3-a456-426614174001',name:'Fixture provider',apiUrl:'https://example.invalid',apiKey:'fake-key',model:'provider-model'}]}},
      async listAgentModels({agent}){
        if(agent!=='claude') return [{slug:agent+'-model',name:agent+' Model'}];
        state.modelCalls++;
        if(state.modelMode==='delay') return new Promise(resolve=>state.resolveModels=resolve);
        if(state.modelMode==='error') throw new Error('secret-must-not-be-displayed');
        if(state.modelMode==='empty') return [];
        return [{slug:'sonnet',name:'Custom Sonnet'},{slug:'opus',name:'Custom Opus'}];
      },
    };
    state.catalog=ACP_AGENT_CATALOG;state.modelKeys=ACP_AGENT_MODEL_ENV;
    const otherService = {...service, async listAgentModels(){return [{slug:'host-b',name:'Host B Model'}]}};
    function Fixture(){
      const [host,setHost]=useState('A');state.switchHost=setHost;
      return <Panel key={host} service={host==='A'?service:otherService}/>;
    }
    function Panel({service}:{service:any}){
      const [agent,setAgent]=useState<any>('claude');state.select=setAgent;
      const management=useAcpAgentManagement(service);
      state.refresh=management.refresh;
      return <AcpAgentManagerPanel agent={agent} service={service} serviceAvailable waiting={false} management={management}/>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{} as any}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1040, height: 840 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://localhost:5174/${name}.html`);
  const token = page.locator("#acp-env-claude-ANTHROPIC_AUTH_TOKEN");
  const model = page.locator("#acp-env-claude-ANTHROPIC_MODEL");
  const save = page.getByRole("button", { name: "保存配置", exact: true });
  await token.waitFor();
  const refresh = page.getByRole("button", { name: "刷新 ACP 模型列表", exact: true });
  const sonnet = page.getByRole("button", { name: "Custom Sonnet sonnet", exact: true });
  await sonnet.waitFor();
  assert.equal(await sonnet.getAttribute("aria-pressed"), "false");
  await sonnet.click();
  assert.equal(await model.inputValue(), "sonnet");
  assert.equal(await sonnet.getAttribute("aria-pressed"), "true");
  await page
    .getByTestId("acp-agent-environment")
    .screenshot({ path: "/tmp/zcode-claude-models-desktop.png" });
  assert.equal(
    await page.evaluate(() => window.__fields.saves.length),
    0,
    "Selecting only changes the draft",
  );
  await save.click();
  await page.waitForFunction(() => window.__fields.saves.length === 1);
  assert.equal(await page.evaluate(() => window.__fields.saves[0].env.ANTHROPIC_MODEL), "sonnet");
  await page.evaluate(() => window.__fields.select("gemini"));
  await page.locator("#acp-env-gemini-GEMINI_MODEL").waitFor();
  await page.evaluate(() => window.__fields.select("claude"));
  await sonnet.waitFor();
  assert.equal(await model.inputValue(), "sonnet", "Saved model survives reopening");
  await model.fill("custom-model");
  await refresh.click();
  await sonnet.waitFor();
  assert.equal(await model.inputValue(), "custom-model", "Refresh preserves custom draft");
  await page.evaluate(() => (window.__fields.modelMode = "error"));
  await refresh.click();
  await page.getByRole("alert").filter({ hasText: "模型列表读取失败" }).waitFor();
  assert.equal(await sonnet.count(), 0);
  assert.ok(!(await page.locator("body").textContent()).includes("secret-must-not-be-displayed"));
  assert.equal(await model.inputValue(), "custom-model");
  await page.evaluate(() => (window.__fields.modelMode = "empty"));
  await refresh.click();
  await page.getByText("暂无模型记录", { exact: false }).waitFor();
  await page.evaluate(() => (window.__fields.modelMode = "delay"));
  await refresh.click();
  await page.waitForFunction(() => Boolean(window.__fields.resolveModels));
  await page.evaluate(() => window.__fields.select("gemini"));
  await page.locator("#acp-env-gemini-GEMINI_MODEL").waitFor();
  await page.evaluate(() => window.__fields.resolveModels([{ slug: "stale", name: "Old Claude" }]));
  assert.equal(await page.getByText("Old Claude", { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.__fields.modelMode = "normal";
    window.__fields.select("claude");
  });
  await sonnet.waitFor();
  await model.fill("");
  await save.click();
  await page.waitForFunction(() => window.__fields.saves.length === 2);
  assert.equal(
    await page.evaluate(() => window.__fields.saves[1].env.ANTHROPIC_MODEL),
    undefined,
    "Clear removes model override",
  );
  await page.evaluate(() => (window.__fields.saves = []));
  assert.equal(await token.getAttribute("type"), "password");
  assert.equal(await page.locator("textarea").count(), 0);
  await model.fill("edited-model");
  await page.evaluate(() => window.__fields.select("gemini"));
  await page.locator("#acp-env-gemini-GEMINI_MODEL").waitFor();
  assert.equal(await page.locator("textarea").count(), 0);
  assert.equal(await page.locator("#acp-env-gemini-GEMINI_MODEL").inputValue(), "");
  await page.evaluate(() => window.__fields.select("opencode"));
  await page.getByTestId("acp-agent-environment").waitFor();
  assert.equal(await page.locator("textarea").count(), 0);
  assert.equal(await page.getByTestId("acp-agent-environment").locator("input").count(), 1);
  await page.evaluate(() => window.__fields.select("claude"));
  await model.waitFor();
  assert.equal(await model.inputValue(), "edited-model");
  await save.click();
  await page.waitForFunction(() => window.__fields.saves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__fields.saves[0].env), {
    ANTHROPIC_AUTH_TOKEN: "fake-token",
    ANTHROPIC_MODEL: "edited-model",
    EXTRA: "keep-existing",
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "保存配置" && b.disabled,
    ),
  );
  await token.fill("");
  await save.click();
  await page.waitForFunction(() => window.__fields.saves.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__fields.saves[1].env), {
    ANTHROPIC_MODEL: "edited-model",
    EXTRA: "keep-existing",
  });
  await page.evaluate(() => window.__fields.refresh());
  assert.equal(await model.inputValue(), "edited-model");
  assert.equal(await token.inputValue(), "");
  const agents = await page.evaluate(() => window.__fields.catalog);
  const modelKeys = await page.evaluate(() => window.__fields.modelKeys);
  for (const { id: agent } of agents) {
    if (agent === "codex" || agent === "claude") continue;
    await page.evaluate((agent) => window.__fields.select(agent), agent);
    const input = page.locator(
      modelKeys[agent] ? `#acp-env-${agent}-${modelKeys[agent]}` : `#acp-default-model-${agent}`,
    );
    const option = page.getByRole("button", { name: `${agent} Model ${agent}-model`, exact: true });
    await option.waitFor();
    await option.click();
    assert.equal(await input.inputValue(), `${agent}-model`);
    assert.equal(await option.getAttribute("aria-pressed"), "true");
    const before = await page.evaluate(() => window.__fields.saves.length);
    await page
      .getByTestId("acp-agent-environment")
      .getByRole("button", { name: /^保存/ })
      .click();
    await page.waitForFunction((before) => window.__fields.saves.length === before + 1, before);
    const saved = await page.evaluate(() => window.__fields.saves.at(-1));
    assert.equal(saved.env.EXTRA, "keep-existing");
    assert.equal(
      modelKeys[agent] ? saved.env[modelKeys[agent]] : saved.defaultModel,
      `${agent}-model`,
    );
    if (!modelKeys[agent])
      assert.deepEqual(
        saved.env,
        { EXTRA: "keep-existing" },
        "No invented model environment variable",
      );
    await page.evaluate(() => window.__fields.select("claude"));
    await model.waitFor();
    await page.evaluate((agent) => window.__fields.select(agent), agent);
    await option.waitFor();
    assert.equal(await input.inputValue(), `${agent}-model`, "Default survives reopening");
    await input.fill("");
    await page
      .getByTestId("acp-agent-environment")
      .getByRole("button", { name: /^保存/ })
      .click();
    await page.waitForFunction((before) => window.__fields.saves.length === before + 2, before);
    const cleared = await page.evaluate(() => window.__fields.saves.at(-1));
    assert.equal(
      modelKeys[agent] ? cleared.env[modelKeys[agent]] : cleared.defaultModel,
      modelKeys[agent] ? undefined : "",
    );
  }
  await page.evaluate(() => window.__fields.select("gemini"));
  await page.locator("#acp-env-gemini-ZCODE_GEMINI_AUTH_MODE").click();
  await page.getByRole("option", { name: "模型供应商", exact: true }).click();
  const providerModel = page.locator("#acp-env-gemini-GEMINI_MODEL");
  await page.waitForFunction(
    () => document.querySelector("#acp-env-gemini-GEMINI_MODEL")?.value === "provider-model",
  );
  assert.equal(await providerModel.getAttribute("readonly"), "");
  assert.equal(
    await page.getByRole("button", { name: "gemini Model gemini-model", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    window.__fields.oldHost = true;
    window.__fields.select("qoder");
    window.__fields.refresh();
  });
  await page.getByText("当前 Host 版本不支持保存此智能体的默认模型", { exact: false }).waitFor();
  assert.equal(await page.locator("#acp-default-model-qoder").getAttribute("readonly"), "");
  await page.evaluate(() => {
    window.__fields.oldHost = false;
    window.__fields.select("claude");
    window.__fields.refresh();
  });
  await sonnet.waitFor();
  await page.setViewportSize({ width: 375, height: 800 });
  await page
    .getByTestId("acp-agent-environment")
    .screenshot({ path: "/tmp/zcode-claude-models-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  await page.evaluate(() => (window.__fields.modelMode = "delay"));
  await refresh.click();
  await page.waitForFunction(() => Boolean(window.__fields.resolveModels));
  await page.evaluate(() => window.__fields.switchHost("B"));
  await page.getByRole("button", { name: "Host B Model host-b", exact: true }).waitFor();
  await page.evaluate(() =>
    window.__fields.resolveModels([{ slug: "stale-host-a", name: "Stale Host A" }]),
  );
  assert.equal(
    await page.getByText("Stale Host A", { exact: true }).count(),
    0,
    "Late Host A result cannot enter Host B",
  );
  assert.equal(
    await page.getByRole("button", { name: "Host B Model host-b", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: all 14 non-Codex default model pickers/save/reopen/clear; Gemini provider ownership, old Host; Claude retry/custom and stale agent/Host isolation; hidden variables and mobile layout.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
