// Shared production timeline and App state transitions; no Host or model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__conversation-find-state-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-conversation-find-"));
const failures = [];
let browser;
console.log(`Conversation find screenshots: ${artifacts}`);

try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    String.raw`
    import React, {useCallback, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
    import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
    import {createTaskFindNavigationState,changeTaskFindSelection,navigateTaskFindSelection} from '../../../ui/src/quickpick/taskFindNavigationState.ts';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import '../../../ui/src/styles.css';
    const kind=new URLSearchParams(location.search).get('kind')??'api';
    const state:any={errors:[],renders:0,reports:0};
    window.__conversationFind=state;
    class Boundary extends React.Component<any,any>{
      state={error:null};
      static getDerivedStateFromError(error:any){return {error}};
      componentDidCatch(error:any){state.errors.push(error.message)};
      render(){return this.state.error?<div data-testid="fixture-error">{this.state.error.message}</div>:this.props.children}
    }
    const nativeRows=Array.from({length:24},(_,index)=>{
      const base={turnId:'native-'+index,createdAt:100+index,createdAtSeq:index};
      return [
        {...base,kind:'turnHeader',rowId:index*3+1,origin:'userInput',executionKind:'agent',state:'completedSuccess',startedAt:100+index},
        {...base,kind:'userInput',rowId:index*3+2,origin:'realUser',text:'Question '+index},
        {...base,kind:'assistantText',rowId:index*3+3,state:'complete',text:('History answer '+index+'\n\n').repeat(5)+(index===23?'needle':'')}
      ];
    }).flat();
    const entries=Array.from({length:24},(_,index)=>[
      {id:'user:command-'+index,kind:'user',text:'Question '+index},
      {id:'assistant:command-'+index,kind:'assistant',text:('History answer '+index+'\n\n').repeat(5)+(index===23?'needle':'')}
    ]).flat();
    const acpRows=buildAcpConversationRows({status:'idle',entries} as any);
    const rowContext={workspacePath:'/synthetic/project',logEpoch:'fixture',theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS};
    const scrollAction={current:null};
    function AppFixture(){
      const [snapshot,setSnapshot]=useState<any>(null);
      const [sessionKey,setSessionKey]=useState(kind+'-history');
      const [find,setFind]=useState(createTaskFindNavigationState);
      const [footerHeight,setFooterHeight]=useState(0);
      const [revision,setRevision]=useState(0);
      state.renders++;
      state.load=()=>setSnapshot({rows:kind==='api'?nativeRows:acpRows});
      state.pending=()=>{setSessionKey(key=>key+'-next');setSnapshot(null)};
      state.query=(query:string)=>setFind(current=>changeTaskFindSelection(current,query,-1));
      state.navigate=()=>setFind(current=>navigateTaskFindSelection(current,current.query,current.activeIndex));
      state.footer=setFooterHeight;
      state.rerender=()=>setRevision(value=>value+1);
      state.bottom=()=>scrollAction.current?.();
      const report=useCallback((next:any)=>{
        state.reports++;state.matchCount=next.matchCount;
        setFind(current=>changeTaskFindSelection(current,current.query,next.activeIndex??-1));
      },[]);
      return <main className="@container/conversation flex h-screen min-h-0 flex-col bg-background text-foreground">
        <span data-testid="revision" className="text-ui-sm">{revision}</span>
        <span data-testid="find-state" data-active-index={find.activeIndex} data-navigation-id={find.navigationRequestId}/>
        <ConversationTimeline rows={snapshot?.rows??[]} totalCount={snapshot?.rows.length??0} sessionKey={sessionKey}
          rowContext={rowContext as any} workDurationAvailable={false} hideTurnNavigator={kind==='acp'}
          scrollToBottomActionRef={scrollAction} conversationFindQuery={find.query} conversationFindActiveIndex={find.activeIndex}
          conversationFindNavigationRequestId={find.navigationRequestId} onConversationFindMatchStateChange={report}
          footerSlot={footerHeight?<div style={{height:footerHeight}}>Permission fixture</div>:null}
          bottomDock={<textarea data-testid="fixture-draft" aria-label="Synthetic draft" className="h-20 w-full border border-border bg-input text-ui-base"/>}/>
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Boundary><AppFixture/></Boundary></TooltipProvider></ZCodeIntlProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  const base = process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174";
  const paint = (page) =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  async function settled(page) {
    await paint(page);
    assert.deepEqual(await page.evaluate(() => window.__conversationFind.errors), []);
    const before = await page.evaluate(() => window.__conversationFind.renders);
    await paint(page);
    assert.equal(
      await page.evaluate(() => window.__conversationFind.renders),
      before,
      "No feedback renders while input is unchanged",
    );
    assert.ok(before < 80, "Bounded render count");
  }
  async function atBottom(page) {
    await page.waitForFunction(() => {
      const timeline = document.querySelector('[data-testid="v4-timeline"]');
      return (
        timeline && Math.abs(timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop) < 3
      );
    });
  }
  for (const kind of ["api", "acp"]) {
    for (const width of [1280, 320]) {
      for (const dark of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height: 720 } });
        page.setDefaultTimeout(7000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const label = `${kind}-${width}-${dark ? "dark" : "light"}`;
        try {
          await page.goto(`${base}/${name}.html?kind=${kind}`);
          await page.waitForFunction(() => window.__conversationFind?.load);
          await page.evaluate((dark) => {
            document.documentElement.classList.toggle("dark", dark);
            document.documentElement.dataset.theme = dark ? "zai-dark" : "zai-light";
          }, dark);
          await settled(page);
          const draft = page.getByTestId("fixture-draft");
          await draft.fill("preserved draft");
          await page.evaluate(() => window.__conversationFind.load());
          await page.getByText("Question 23", { exact: true }).waitFor();
          await atBottom(page);
          await settled(page);
          await page.evaluate(() => window.__conversationFind.query("needle"));
          await page.waitForFunction(() => window.__conversationFind.matchCount === 1);
          await settled(page);
          const navigationId = await page
            .getByTestId("find-state")
            .getAttribute("data-navigation-id");
          await page.evaluate(() => window.__conversationFind.navigate());
          await page.waitForFunction(
            (previous) =>
              document.querySelector('[data-testid="find-state"]').dataset.navigationId !==
              previous,
            navigationId,
          );
          await settled(page);
          await page.evaluate(() => window.__conversationFind.query(""));
          await page.waitForFunction(() => window.__conversationFind.matchCount === 0);
          await page.evaluate(() => window.__conversationFind.bottom());
          await atBottom(page);
          await page.evaluate(() => window.__conversationFind.footer(350));
          await atBottom(page);
          await page.getByTestId("v4-timeline").hover();
          await page.mouse.wheel(0, -350);
          await page.waitForFunction(
            () =>
              document.querySelector('[data-testid="v4-timeline"]').dataset.following === "false",
          );
          const scrollTop = await page
            .getByTestId("v4-timeline")
            .evaluate((element) => element.scrollTop);
          await page.evaluate(() => window.__conversationFind.footer(550));
          await settled(page);
          assert.ok(
            Math.abs(
              (await page.getByTestId("v4-timeline").evaluate((element) => element.scrollTop)) -
                scrollTop,
            ) < 3,
            "Reader retains scroll position",
          );
          await page.evaluate(() => window.__conversationFind.pending());
          await settled(page);
          await page.evaluate(() => window.__conversationFind.load());
          await page.getByText("Question 23", { exact: true }).waitFor();
          await atBottom(page);
          assert.equal(await draft.inputValue(), "preserved draft");
          for (let index = 0; index < 3; index++) {
            await page.evaluate(() => window.__conversationFind.rerender());
            await settled(page);
          }
          assert.deepEqual(errors, []);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({ path: join(artifacts, `${label}.png`) });
          console.log(`PASS ${label}: pending history, find, navigation, switch and scroll`);
        } catch (error) {
          failures.push(`${label}: ${error.stack || error.message}`);
          console.error(`FAIL ${label}: ${error.message}`);
          await page.screenshot({ path: join(artifacts, `${label}-failed.png`) });
        } finally {
          await page.close();
        }
      }
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
