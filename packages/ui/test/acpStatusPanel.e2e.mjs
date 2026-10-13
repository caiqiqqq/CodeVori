// Real SessionPane/status panel, synthetic Host, no user history or real Agent prompts.
// ZCODE_E2E_BASE_URL=http://localhost:5174 node packages/ui/test/acpStatusPanel.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-status-panel-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-status-panel-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SessionPane} from '../../../ui/src/v4/SessionPane.tsx';
      import {V4ConversationContext} from '../../../ui/src/v4/V4ConversationContext.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/test/acpProjectionFixture.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
      const workspacePath='/synthetic/status';
      const listeners=new Set(); const events=[];
      let snapshot={id:'11111111-1111-4111-8111-111111111111',agent:'codex',workspacePath,acpSessionId:'native-fixture',
        title:'status fixture',revision:1,status:'idle',entries:[{id:'user:first',kind:'user',text:'first task'},
          {id:'plan:first',kind:'plan',entries:[{content:'ACP inspect source',priority:'high',status:'in_progress'}]}],
        usageTurns:[],nativeUsage:{nativeSessionId:'native-fixture',usage:{inputTokens:100,outputTokens:20,totalTokens:120,cacheReadTokens:60}},configOptions:[],modeState:null,contextUsage:null,goal:'ACP objective',pendingPermission:null,error:null,
        queue:{items:[],autoDrain:true}};
      const copy=()=>structuredClone(snapshot);
      const publish=()=>{snapshot={...snapshot,revision:snapshot.revision+1};for(const listener of listeners) listener({kind:'updated',session:copy()});return copy()};
      const service={list:async()=>[copy()],listAvailableAgents:async()=>[{agent:'codex',available:true}],listAgentConfigs:async()=>[],listPlugins:async()=>[],onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),refresh:async()=>copy(),read:async()=>copy(),
        onDynamicSessionChanged:()=>listener=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
        onDynamicExecutionTraceChanged:()=>()=>({dispose(){}}),getExecutionTrace:async()=>({events:[]}),
        create:async()=>{events.push('create');throw Error('no Agent creation')},prompt:async()=>{events.push('prompt');throw Error('no prompt')},
        stop:async()=>{},remove:async()=>{},
        stopTerminal:async input=>{if(input.id!==snapshot.id||input.workspacePath!==workspacePath||input.terminalId!=='managed')throw Error('wrong terminal scope');events.push('stop:'+input.terminalId);snapshot.terminals=snapshot.terminals.map(t=>({...t,status:'finished',output:t.output+' stopped'}));publish()}};
      const forbidden=()=>{throw new Error('unexpected native/model operation')};
      const native={layer:{acquire:forbidden},sendCommand:forbidden,attachmentPut:forbidden,
        onRuntimeRestart:()=>()=>{},onRuntimeLifecycle:()=>()=>{}};
      const services={settingService:{get:async()=>({})},clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
        clientScenesService:{list:async()=>({code:0,data:[]})},modelSelectionService:{getView:async()=>({revision:1,providers:[]}),onDidChange:()=>({dispose(){}})},acpService:service, gitService:{
          getLocalBranches:async ({workspacePath})=>{events.push('branches:'+workspacePath);return {headRefType:'branch',currentBranchName:'fixture-main',branches:['fixture-main','fixture-other'].map(name=>({name,isCurrent:name==='fixture-main',upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}))}},
        }};
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      const dirtySummary={workspacePath,repoRoot:workspacePath,workspaceInRepoPath:'.',autoRefreshWatchPaths:[],branchName:'fixture-main',trackingBranchName:null,headRefType:'branch',ahead:0,behind:0,isDirty:true,isGitAvailable:true,isRepository:true};
      function Fixture(){
        const [epoch,setEpoch]=useState(0);
        const [dirty,setDirty]=useState(true);
        const [noGit,setNoGit]=useState(false);
        const [variant,setVariant]=useState(null);
        window.__status={events,read:copy,dirty:setDirty,noGit:setNoGit,
          startCommands:()=>{snapshot.status='running';snapshot.entries.push(
            {id:'execute',kind:'tool',title:'npm run dev',toolKind:'execute',status:'in_progress',createdAt:Date.now(),input:'npm run dev',output:'tool ready'},
            {id:'linked',kind:'tool',title:'linked terminal',toolKind:'execute',status:'in_progress',terminalIds:['managed'],createdAt:Date.now()},
            {id:'done',kind:'tool',title:'completed command',toolKind:'execute',status:'completed',createdAt:Date.now()});
            snapshot.terminals=[{terminalId:'managed',title:'node server',status:'running',startedAt:Date.now(),output:'server ready',truncated:false}];publish()},
          idle:()=>{snapshot.status='idle';publish()},
          replay:()=>{publish();setEpoch(n=>n+1)},
          clearPlan:()=>{snapshot.entries=snapshot.entries.map(e=>e.kind==='plan'?{...e,entries:[]}:e);publish()},
          nextTurn:()=>{snapshot.entries.push({id:'user:second',kind:'user',text:'second'});publish()},
          goal:goal=>{snapshot.goal=goal;publish()},
          nextSession:()=>{snapshot={...snapshot,id:'22222222-2222-4222-8222-222222222222',title:'second fixture',acpSessionId:'second-native',nativeUsage:null,usageTurns:[],entries:[{id:'user:other',kind:'user',text:'other'}],goal:'second objective'};setEpoch(n=>n+1)},
        };
        return <main className="h-screen bg-background text-foreground p-2" data-fixture-ready="true" data-fixture-epoch={epoch}>
          <SessionPane key={epoch} paneId="status-fixture" workspacePath={workspacePath} sessionId={null} focused
            gitWorktreeReviewSourceId="unstaged" gitSummary={noGit?undefined:dirtySummary} gitDirtyFileCount={dirty?2:0}
            gitWorktreeChangeSummary={dirty?{added:12,removed:3}:{added:0,removed:0}}
            onRefreshGit={()=>events.push('refresh')}
            onOpenGitReview={source=>events.push('review:'+source)}
            summaryPanelVariantOverride={variant} onSummaryPanelVariantOverrideChange={setVariant}
            acpBoundSessionId={snapshot.id} acpOpenRequest={{requestId:epoch+1,session:copy()}} />
        </main>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><V4ConversationContext.Provider value={native as never}><Fixture/></V4ConversationContext.Provider></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(60000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByTestId("v4-composer-input")
        .waitFor()
        .catch((error) => {
          throw new Error(errors.join("\n") || error.message);
        });
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.add(
            "theme-" + theme,
            ...(theme === "zai-dark" ? ["dark"] : []),
          ),
        theme,
      );
      const panel = page.getByTestId("chat-summary-panel");
      await panel.waitFor();
      const context = page.getByTestId("chat-context-usage-trigger");
      const checkTokens = async (expected) => {
        await context.hover();
        await page.getByTestId("context-token-usage").waitFor();
        assert.equal(
          await page.getByTestId("context-token-total").locator("dd").textContent(),
          expected,
        );
        if (expected === "120") {
          assert.equal(
            await page.getByTestId("context-token-cacheRead").locator("dd").textContent(),
            "60",
          );
          assert.equal(
            await page.getByTestId("context-token-cacheWrite").locator("dd").textContent(),
            "—",
          );
          assert.equal(
            await page.getByTestId("context-token-hitRate").locator("dd").textContent(),
            "60%",
          );
          await page.getByText("智能体尚未返回上下文用量", { exact: true }).waitFor();
          await page.screenshot({
            path: join(artifacts, `tokens-${width}-${theme}.png`),
            animations: "disabled",
          });
        }
        await page.mouse.move(0, 0);
        await page.getByTestId("v4-composer-input").click();
        await page.getByTestId("context-token-usage").waitFor({ state: "hidden" });
      };
      await checkTokens("120");
      const expand = async () => {
        const button = panel.getByRole("button", { name: "展开状态" });
        const mode = await panel.getAttribute("data-display-mode");
        if (mode === "mini" || (mode === "auto" && width === 375)) await button.click();
      };
      await expand();
      await panel.getByText("fixture-main", { exact: true }).waitFor();
      assert.equal(await panel.locator("[data-goal-action]").count(), 0);
      await panel.locator("[data-acp-objective]").filter({ hasText: "ACP objective" }).waitFor();
      await panel.getByTitle("ACP inspect source", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "收起为胶囊" }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="chat-summary-panel"]')
            ?.getAttribute("data-display-mode") === "mini",
      );
      await expand();
      await panel.getByRole("button", { name: "状态面板展开策略" }).click();
      await page.getByRole("menuitemradio", { name: "自动展开" }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="chat-summary-panel"]')
            ?.getAttribute("data-display-mode") === "auto",
      );
      await expand();
      // 宽屏与 API 使用同一正文/输入框让位规则；手机保持胶囊自动模式且不横向溢出。
      if (width === 1440) {
        const rect = await panel.boundingBox();
        const inputRect = await page.getByTestId("v4-composer-input").boundingBox();
        assert.ok(rect && inputRect && inputRect.x + inputRect.width <= rect.x);
      }
      await page.waitForFunction(() =>
        [...document.getAnimations()].every((a) => a.playState !== "running"),
      );
      await page.screenshot({ path: join(artifacts, `plan-${width}-${theme}.png`) });
      await panel.getByRole("button").filter({ hasText: "更改" }).click();
      assert.deepEqual(await page.evaluate(() => window.__status.events), ["review:unstaged"]);
      await panel.getByRole("button").filter({ hasText: "fixture-main" }).click();
      await page.getByText("fixture-other", { exact: true }).waitFor();
      assert.ok(
        (await page.evaluate(() => window.__status.events)).includes("branches:/synthetic/status"),
      );
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.__status.startCommands());
      await panel.locator('[data-status-section-trigger="terminal"]').click();
      const command = panel.locator('[data-work-id="acp-tool:execute"]');
      const managed = panel.locator('[data-work-id="acp-terminal:managed"]');
      await command.waitFor();
      await managed.waitFor();
      assert.equal(await panel.getAttribute("data-running-terminal-count"), "2");
      await page.screenshot({
        path: join(artifacts, `terminals-${width}-${theme}.png`),
        animations: "disabled",
      });
      assert.equal(await command.locator('[data-testid^="v4-background-work-cancel"]').count(), 0);
      await command.getByTestId("background-bash-open").click();
      const output = page.getByTestId("acp-terminal-output");
      await output.getByText("tool ready", { exact: false }).waitFor();
      assert.equal(await output.getByRole("button", { name: "停止命令" }).count(), 0);
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.__status.idle());
      await command.waitFor({ state: "detached" });
      await managed.getByTestId("background-bash-open").click();
      await output.getByText("server ready", { exact: true }).waitFor();
      await page.screenshot({
        path: join(artifacts, `terminal-output-${width}-${theme}.png`),
        animations: "disabled",
      });
      await output.getByRole("button", { name: "停止命令" }).click();
      await output.getByText("server ready stopped", { exact: true }).waitFor();
      await managed.waitFor({ state: "detached" });
      assert.ok((await page.evaluate(() => window.__status.events)).includes("stop:managed"));
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.__status.clearPlan());
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-testid="chat-summary-panel"]')
            ?.textContent.includes("ACP inspect source"),
      );
      await page.evaluate(() => window.__status.nextTurn());
      await page.evaluate(() => window.__status.replay());
      await page.locator('[data-fixture-epoch="1"]').waitFor();
      await checkTokens("120");
      await expand();
      await panel.getByText("fixture-main", { exact: true }).waitFor();
      await panel.locator("[data-acp-objective]").waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      await page.waitForFunction(() =>
        [...document.getAnimations()].every((a) => a.playState !== "running"),
      );
      await page.screenshot({ path: join(artifacts, `expanded-${width}-${theme}.png`) });
      await page.evaluate(() => window.__status.nextSession());
      await page.locator('[data-fixture-epoch="2"]').waitFor();
      await checkTokens("—");
      await panel.locator("[data-acp-objective]").filter({ hasText: "second objective" }).waitFor();
      assert.equal(await panel.getByText("ACP objective", { exact: true }).count(), 0);
      await page.evaluate(() => window.__status.dirty(false));
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-testid="chat-summary-panel"]')
            ?.textContent.includes("fixture-main"),
      );
      await page.evaluate(() => window.__status.goal(null));
      await panel.waitFor({ state: "detached" });
      await page.evaluate(() => {
        window.__status.dirty(true);
        window.__status.noGit(true);
      });
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="chat-summary-panel"]'),
      );
      assert.equal(await panel.count(), 0);
      assert.equal(
        (await page.evaluate(() => window.__status.events)).some(
          (e) => e === "create" || e === "prompt",
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(`ACP status panel E2E passed: desktop/mobile, light/dark. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
