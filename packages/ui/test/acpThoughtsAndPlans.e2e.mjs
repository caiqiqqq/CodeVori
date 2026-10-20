// Actual timeline with synthetic Host snapshots; no model, credential or user-data access.
// ZCODE_E2E_BASE_URL=http://localhost:5174 node packages/ui/test/acpThoughtsAndPlans.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-thought-plan-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-thought-plan-e2e-"));
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
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
      import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const seed=()=>({status:'running',entries:[
        {id:'user:fixture',kind:'user',text:'Inspect the fixture'},
        {id:'thought:fixture:one',kind:'thought',text:'first reported thought',state:'complete',durationMs:100},
        {id:'tool:fixture:read',kind:'tool',title:'Read fixture',toolKind:'read',status:'completed',content:'fixture data'},
        {id:'plan:fixture',kind:'plan',entries:[{content:'Inspect source',priority:'high',status:'completed'},{content:'Run checks',priority:'medium',status:'pending'}]},
        {id:'thought:fixture:two',kind:'thought',text:'second reported thought',state:'streaming'},
      ]});
      function Fixture(){
        const [snapshot,setSnapshot]=useState(seed);
        const [epoch,setEpoch]=useState(0);
        const [reasoning,setReasoning]=useState(true);
        const [todos,setTodos]=useState(true);
        const [api,setApi]=useState(false);
        window.__thoughts={
          append:()=>setSnapshot(s=>({...s,entries:s.entries.map(e=>e.id==='thought:fixture:two'?{...e,text:e.text+' appended chunk'}:e)})),
          plan:()=>setSnapshot(s=>({...s,entries:s.entries.map(e=>e.kind==='plan'?{...e,entries:seed().entries.find(entry=>entry.kind==='plan')!.entries.map(step=>({...step,status:'completed'}))}:e)})),
          clearPlan:()=>setSnapshot(s=>({...s,entries:s.entries.map(e=>e.kind==='plan'?{...e,entries:[]}:e)})),
          interrupt:()=>setSnapshot(s=>({...s,status:'interrupted',entries:s.entries.map(e=>e.kind==='thought'&&e.state==='streaming'?{...e,state:'interrupted',durationMs:200}:e)})),
          finish:()=>setSnapshot(s=>({...s,status:'idle',entries:[...s.entries.map(e=>e.kind==='thought'?{...e,state:'complete'}:e),{id:'assistant:fixture',kind:'assistant',text:'Final fixture answer'}]})),
          replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
          reasoning:setReasoning,todos:setTodos,
          api:()=>{setApi(true);setEpoch(e=>e+1)},
        };
        const rows=buildAcpConversationRows(snapshot as never);
        const displayRows=api?rows.map(row=>row.kind==='plan'?{...row,kind:'toolCall',toolCallId:'api-todo',toolName:'TodoWrite',status:'success',inputText:'TodoWrite',input:{todos:row.entries.map((e,i)=>({id:String(i),content:e.content,status:e.status}))},entries:undefined}:row):rows;
        return <div className="h-screen flex flex-col bg-background text-foreground" data-fixture-ready="true" data-fixture-epoch={epoch} data-fixture-status={snapshot.status}>
          <ConversationTimeline key={epoch} sessionKey={'thought-fixture-'+epoch} rows={displayRows as never} totalCount={displayRows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',
              codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch,
              messageStreamShowReasoning:reasoning,messageStreamShowTodos:todos}} />
        </div>;
      }
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
      await page.locator('[data-fixture-ready="true"]').waitFor();
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.add(
            `theme-${theme}`,
            ...(theme === "zai-dark" ? ["dark"] : []),
          ),
        theme,
      );
      const history = page.locator('[data-testid^="chat-assistant-history-trigger-"]');
      const openHistory = async () => {
        if (
          (await history.count()) &&
          (await history.first().getAttribute("data-history-open")) === "false"
        )
          await history.first().click();
      };
      await openHistory();
      const thoughts = page.getByTestId("chat-reasoning-trigger");
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="chat-reasoning-trigger"]').length === 2,
      );
      await thoughts.last().waitFor({ state: "visible" });
      assert.equal(await thoughts.last().getAttribute("data-state"), "closed");
      await thoughts.last().click();
      await page
        .getByTestId("chat-reasoning-content")
        .filter({ hasText: "second reported thought" })
        .waitFor();
      await page.evaluate(() => window.__thoughts.append());
      await page
        .getByTestId("chat-reasoning-content")
        .filter({ hasText: "appended chunk" })
        .waitFor();
      const plan = page.locator('[data-conversation-plan="plan:fixture"]');
      await plan.waitFor();
      const summary = plan.locator('[data-testid^="tool-summary-trigger-"]');
      assert.match(await summary.innerText(), /1\/2/);
      await summary.click();
      await plan.getByText("Inspect source", { exact: true }).waitFor();
      assert.equal(await plan.locator('[data-plan-step-status="pending"]').count(), 1);
      await page.evaluate(() => window.__thoughts.plan());
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-conversation-plan] [data-plan-step-status="completed"]')
            .length === 2,
      );
      assert.match(await summary.innerText(), /2\/2/);
      await page.evaluate(() => window.__thoughts.reasoning(false));
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="chat-reasoning-trigger"]').length === 1,
      );
      await page.evaluate(() => window.__thoughts.todos(false));
      await page.waitForFunction(() => !document.querySelector("[data-conversation-plan]"));
      await page.evaluate(() => {
        window.__thoughts.reasoning(true);
        window.__thoughts.todos(true);
      });
      await plan.waitFor({ state: "visible" });
      await page.evaluate(() => window.__thoughts.clearPlan());
      await plan.waitFor({ state: "detached" });
      await page.evaluate(() => {
        window.__thoughts.plan();
        window.__thoughts.interrupt();
      });
      await page.locator('[data-fixture-status="interrupted"]').waitFor();
      await openHistory();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="chat-reasoning-trigger"]').length === 2,
      );
      await page.evaluate(() => window.__thoughts.replay());
      await page.locator('[data-fixture-epoch="1"]').waitFor();
      await openHistory();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="chat-reasoning-trigger"]').length === 2,
      );
      assert.equal(await page.locator("[data-conversation-plan]").count(), 1);
      await thoughts.last().waitFor({ state: "visible" });
      await plan.waitFor({ state: "visible" });
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-slot="collapsible-content"]')].every((element) =>
          element.getAnimations().every((animation) => animation.playState !== "running"),
        ),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      // Remounted history also animates opacity; DOM presence is insufficient.
      await page.waitForFunction(() => {
        let element = [...document.querySelectorAll('[data-testid="chat-reasoning-trigger"]')].at(
          -1,
        );
        if (!element) return false;
        while (element) {
          if (Number(getComputedStyle(element).opacity) < 0.95) return false;
          element = element.parentElement;
        }
        return true;
      });
      await page.screenshot({ path: join(artifacts, `replay-${width}-${theme}.png`) });
      await page.evaluate(() => window.__thoughts.finish());
      await page.getByText("Final fixture answer", { exact: true }).waitFor();
      await page.evaluate(() => window.__thoughts.api());
      await page.locator('[data-fixture-epoch="2"]').waitFor();
      await openHistory();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="chat-reasoning-trigger"]').length === 2,
      );
      const apiTodo = page.getByTestId("tool-summary-trigger-api-todo");
      await apiTodo.waitFor();
      await apiTodo.click();
      await page.getByText("Inspect source", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-plan-step-status="completed"]').count(), 2);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(`ACP thoughts/plans E2E passed: desktop/mobile, light/dark. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
