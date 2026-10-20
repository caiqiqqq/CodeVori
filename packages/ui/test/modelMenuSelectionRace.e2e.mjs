// node packages/ui/test/modelMenuSelectionRace.e2e.mjs (desktop Vite on 5174)
// Real shared model menu + ACP read hook; controlled fake Hosts, no Agent launch or prompt.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__model-menu-race-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ModelConfigSelect } from '../../../ui/src/ModelConfigSelect.tsx';
    import { useAvailableAcpAgents } from '../../../ui/src/v4/composer/useAvailableAcpAgents.ts';
    import { buildAcpModelSelectGroup } from '../../../ui/src/v4/composer/acpModelSelection.ts';
    import { ZCodeIntlProvider } from '../../../ui/src/i18n/IntlProvider.tsx';
    import { TooltipProvider } from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    window.__modelSelections=[];
    window.__agentReads=[];
    const services=[0,1].map(host=>({listAvailableAgents:()=>new Promise((resolve,reject)=>{
      window.__agentReads.push({host,resolve,reject});
    })}));
    function Fixture(){
      const [host,setHost]=useState(0);
      const [enabled,setEnabled]=useState(true);
      const [conversation,setConversation]=useState('native-A');
      const [apiCount,setApiCount]=useState(1);
      const [value,setValue]=useState('api:1');
      const [open,setOpen]=useState(false);
      const {agents,refresh}=useAvailableAcpAgents(services[host] as never,enabled);
      window.__setMenuHost=setHost;
      window.__setMenuEnabled=setEnabled;
      window.__setApiCount=setApiCount;
      window.__switchMenuConversation=()=>{setConversation('native-B');setValue('api:1');setOpen(false);};
      window.__refreshMenuAgents=refresh;
      const api=Array.from({length:apiCount},(_,i)=>({key:'registry-provider:api-'+(i+1),label:'API '+(i+1),items:[{key:'api:'+(i+1),value:'api:'+(i+1),name:'API Model '+(i+1)}]}));
      const acp=buildAcpModelSelectGroup('智能体',agents);
      return <main style={{position:'fixed',bottom:30,right:30}} data-testid="menu-fixture"
        data-conversation={conversation} data-value={value} data-agents={agents.map(a=>a.agent).join(',')}>
        <ModelConfigSelect modelGroups={[...api,...(acp.items.length?[acp]:[])]}
          normalizedValue={value} triggerLabel={value} showManageModelsAction manageModelsLabel="管理模型"
          lockReasonMessage="" isItemLocked={()=>false} onValueChange={value=>{window.__modelSelections.push(value);setValue(value);}}
          open={open} onOpenChange={value=>{if(value)refresh();setOpen(value);}}
          focusSelectorOnClose={null} />
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      hasTouch: width === 375,
      isMobile: width === 375,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://localhost:5174/${name}.html`);
    const trigger = page.getByTestId("chat-model-select-trigger");
    const fixture = page.getByTestId("menu-fixture");
    const claude = page.getByTestId("chat-model-select-item-acp:claude");
    const codex = page.getByTestId("chat-model-select-item-acp:codex");
    const api = page.locator('[data-model-provider-key="registry-provider:api-1"]');
    await trigger.waitFor();
    await page.evaluate(() => window.__switchMenuConversation());
    await fixture
      .getAttribute("data-conversation")
      .then((value) => assert.equal(value, "native-B"));
    await trigger.click();
    await page.waitForFunction(() => window.__agentReads.length === 2);
    const activeRead = await page.evaluate(() => window.__agentReads.length - 1);
    const box = await api.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.evaluate(
      (index) =>
        window.__agentReads[index].resolve([
          { agent: "claude", enabled: true, ready: true },
          { agent: "codex", enabled: true, ready: true },
        ]),
      activeRead,
    );
    await codex.waitFor();
    await page.waitForFunction(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-testid]")
          ?.getAttribute("data-testid")
          ?.startsWith("chat-model-select-item-acp:"),
      point,
    );
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.__modelSelections),
      [],
      "catalog growth during an API press must not select the ACP item that moved underneath",
    );
    assert.equal(await fixture.getAttribute("data-value"), "api:1");
    assert.equal(await fixture.getAttribute("data-conversation"), "native-B");

    await page.keyboard.press("Escape");
    await trigger.click();
    await claude.waitFor();
    assert.equal(
      await fixture.getAttribute("data-agents"),
      "claude,codex",
      "same-Host refresh must preserve the previous successful projection",
    );
    const claudeBox = await claude.boundingBox();
    const claudePoint = {
      x: claudeBox.x + claudeBox.width / 2,
      y: claudeBox.y + claudeBox.height / 2,
    };
    await page.mouse.move(claudePoint.x, claudePoint.y);
    await page.mouse.down();
    await page.evaluate(() =>
      window.__agentReads.at(-1).resolve([
        { agent: "claude", enabled: true, ready: true },
        { agent: "codex", enabled: true, ready: true },
        { agent: "gemini", enabled: true, ready: true },
      ]),
    );
    await page.waitForFunction(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ===
        "chat-model-select-item-acp:codex",
      claudePoint,
    );
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.__modelSelections),
      [],
      "a press on Claude cannot select Codex after menu growth",
    );
    if (width === 375) await claude.tap();
    else await claude.click();
    assert.deepEqual(await page.evaluate(() => window.__modelSelections), ["acp:claude"]);
    await trigger.click();
    await codex.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.__modelSelections), [
      "acp:claude",
      "acp:codex",
    ]);
    await trigger.click();
    await claude.focus();
    await page.keyboard.press("Space");
    assert.deepEqual(await page.evaluate(() => window.__modelSelections), [
      "acp:claude",
      "acp:codex",
      "acp:claude",
    ]);

    await trigger.click();
    await api.hover();
    const apiModel = page.getByTestId("chat-model-select-item-api:1");
    await apiModel.waitFor();
    await apiModel.click();
    assert.deepEqual(await page.evaluate(() => window.__modelSelections), [
      "acp:claude",
      "acp:codex",
      "acp:claude",
      "api:1",
    ]);

    // A read response that uninstalls/disables an Agent is authoritative; pending is not failure.
    await trigger.click();
    await page.evaluate(() =>
      window.__agentReads.at(-1).resolve([{ agent: "codex", enabled: true, ready: true }]),
    );
    await claude.waitFor({ state: "hidden" });
    assert.equal(await fixture.getAttribute("data-agents"), "codex");
    const beforeRefresh = await page.evaluate(() => window.__agentReads.length);
    await page.evaluate(() => window.__refreshMenuAgents());
    await page.waitForFunction((length) => window.__agentReads.length > length, beforeRefresh);
    await page.evaluate(() => window.__agentReads.at(-1).reject(new Error("fixture read failure")));
    await codex.waitFor({ state: "hidden" });
    assert.equal(await fixture.getAttribute("data-agents"), "");

    // Old requests/Hosts cannot restore a failed or new Host's projection.
    await page.evaluate(() =>
      window.__agentReads[0].resolve([{ agent: "claude", enabled: true, ready: true }]),
    );
    await page.evaluate(() => window.__setMenuHost(1));
    await page.waitForFunction(() => window.__agentReads.at(-1)?.host === 1);
    assert.equal(await fixture.getAttribute("data-agents"), "");
    await page.evaluate(() =>
      window.__agentReads.at(-1).resolve([{ agent: "gemini", enabled: true, ready: true }]),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="menu-fixture"]')?.getAttribute("data-agents") ===
        "gemini",
    );
    await page.evaluate(() =>
      window.__agentReads[2].resolve([{ agent: "codex", enabled: true, ready: true }]),
    );
    assert.equal(
      await fixture.getAttribute("data-agents"),
      "gemini",
      "a superseded Host read cannot restore its options",
    );
    await page.evaluate(() => window.__setMenuEnabled(false));
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="menu-fixture"]')?.getAttribute("data-agents") === "",
    );
    const beforeEnable = await page.evaluate(() => window.__agentReads.length);
    await page.evaluate(() => window.__setMenuEnabled(true));
    await page.waitForFunction((length) => window.__agentReads.length > length, beforeEnable);
    assert.equal(
      await fixture.getAttribute("data-agents"),
      "",
      "reenabling must wait for a new report after disabling cleared the projection",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: delayed catalogs cannot redirect an API press to ACP; explicit mouse/touch/keyboard selection and scoped Host refresh at 1280/375px.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
