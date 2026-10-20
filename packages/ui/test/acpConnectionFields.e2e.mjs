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
    import {createRoot} from 'react-dom/client';
    import {AcpAgentManagerPanel} from '../../../ui/src/settings/AcpAgentManagerPanel.tsx';
    import {useAcpAgentManagement} from '../../../ui/src/settings/useAcpAgentManagement.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import '../../../ui/src/styles.css';
    const base = {command:'fake',args:[],distribution:'npm',enabled:true,source:'system',ready:true,installedVersion:'1.0.0',registryVersion:'1.0.0',managedVersion:null,executablePath:'/fake/agent',nodeVersion:'24.14.0',npmVersion:'10.33.2',updateCheck:{status:'unavailable',source:'builtin',checkedAt:null}};
    const agents = ['claude','gemini','opencode'].map(agent=>({...base,agent,env: agent==='claude'?{ANTHROPIC_AUTH_TOKEN:'fake-token',ANTHROPIC_MODEL:'original',EXTRA:'keep-existing'}:{}}));
    const state:any = {saves:[]}; window.__fields=state;
    const service:any = {
      async listAgents(){return agents.map(a=>({...a,env:{...a.env}}))},
      async updateAgent(input:any){state.saves.push(input);const a=agents.find(a=>a.agent===input.agent)!;Object.assign(a,input);return {...a}},
      onDynamicAgentOperation(){return ()=>({dispose(){}})},
      async listGeminiProviders(){return {version:'fake',providers:[]}},
    };
    function Fixture(){
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
  assert.equal(await page.getByTestId("acp-agent-environment").locator("input").count(), 0);
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
  await page.setViewportSize({ width: 375, height: 800 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS: no raw editor; masked credentials, agent drafts, save/clear/refresh preserve hidden variables, narrow layout.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
