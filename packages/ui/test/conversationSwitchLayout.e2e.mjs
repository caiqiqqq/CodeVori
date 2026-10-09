// pnpm exec tsx packages/ui/test/conversationSwitchLayout.e2e.mjs
// Real Timeline geometry, synthetic projections, no Host commands or model requests.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__conversation-switch-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "conversation-switch-e2e-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
import React, {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
import {applyTheme} from '../../../ui/src/useTheme.ts';
import '../../../ui/src/styles.css';
const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
const context={workspacePath:'/fixture/switch',theme:'zai-light',
  codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture'};
function rows(kind,offset=0,count=12){
  const entries=Array.from({length:count},(_,index)=>{
    const id=index+offset;
    return [{id:'user:'+id,kind:'user',text:'Question '+id},
      {id:'assistant:'+id,kind:'assistant',text:kind==='short'?'Short answer '+id:
        Array.from({length:8+id%4},(_,line)=>'Paragraph '+id+' / '+line+' — full answer.').join('\\n\\n')}];
  }).flat();
  return buildAcpConversationRows({entries,status:'idle'}).map(row=>({...row,rowId:row.rowId+offset*4}));
}
const projections={short:rows('short'),tall:rows('tall'),shifted:rows('tall',20),
  prepend:rows('tall',18,14),running:buildAcpConversationRows({entries:[
    {id:'user:0',kind:'user',text:'Running question'},
    {id:'assistant:0',kind:'assistant',text:'Running answer'}],status:'running'})};
function Fixture(){
  const [view,setView]=useState({session:'draft',kind:'empty',rows:[]});
  const [allowOlder,setAllowOlder]=useState(false);
  const [theme,setTheme]=useState('zai-light');
  const rowContext=useMemo(()=>({...context,theme}),[theme]);
  window.__applyFixtureTheme=theme=>{applyTheme(theme);setTheme(theme)};
  window.__allowOlder=()=>setAllowOlder(true);
  window.__switchView=(session,kind)=>{setAllowOlder(false);setView({session,kind,rows:projections[kind]??[]})};
  return <div className="h-screen flex flex-col bg-background text-foreground"
    data-ready="true" data-session={view.session} data-kind={view.kind} data-allow-older={allowOlder}>
    <ConversationTimeline sessionKey={view.session} scrollMemoryKey={view.session==='draft'?null:'fixture:'+view.session}
      rows={view.rows} totalCount={view.rows.length} rowContext={rowContext} hideTurnNavigator
      canLoadOlder={allowOlder && view.kind==='shifted'} onLoadOlder={()=>setView({...view,kind:'prepend',rows:projections.prepend})}
      workDurationAvailable={false} bottomDock={<textarea data-testid="persistent-composer" defaultValue="retained draft"/>}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}>
  <TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN">
    <TooltipProvider><Fixture/></TooltipProvider>
  </ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
`,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5187"}/${name}.html`);
      await page.locator('[data-ready="true"]').waitFor();
      await page.evaluate((theme) => {
        window.__applyFixtureTheme(theme);
        window.__composer = document.querySelector('[data-testid="persistent-composer"]');
        window.__scroll = document.querySelector("[data-v4-timeline-scroll]");
        window.__frames = [];
        window.__overlaps = [];
        window.__captureFrames = true;
        window.__captureOverlaps = true;
        const sample = () => {
          const viewport = window.__scroll.getBoundingClientRect();
          const units = [
            ...document.querySelectorAll(
              "[data-v4-timeline-virtual-history] > [data-v4-turn-unit]",
            ),
          ]
            .map((node) => ({
              index: Number(node.dataset.index),
              id: node.dataset.turnId,
              rect: node.getBoundingClientRect(),
            }))
            .sort((a, b) => a.index - b.index);
          const kind = document.querySelector("[data-ready]").getAttribute("data-kind");
          window.__frames.push(kind);
          for (let i = 1; i < units.length; i++) {
            const previous = units[i - 1],
              current = units[i];
            if (
              window.__captureOverlaps &&
              previous.rect.bottom > current.rect.top + 1 &&
              current.rect.bottom > viewport.top &&
              current.rect.top < viewport.bottom
            ) {
              window.__overlaps.push({
                kind,
                session: document.querySelector("[data-ready]").getAttribute("data-session"),
                previous: previous.id,
                current: current.id,
                bottom: previous.rect.bottom,
                top: current.rect.top,
              });
            }
          }
          if (window.__captureFrames) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, theme);
      const switchView = async (session, kind) => {
        console.log(`Checking ${width}/${theme}: ${session}/${kind}`);
        await page.evaluate(
          ([session, kind]) => window.__switchView(session, kind),
          [session, kind],
        );
        await page.waitForFunction(
          ([session, kind]) => {
            const root = document.querySelector("[data-ready]");
            return (
              root?.getAttribute("data-session") === session &&
              root?.getAttribute("data-kind") === kind
            );
          },
          [session, kind],
        );
        // Observe multiple actual paint opportunities, including the very first switched frame.
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              let frames = 0;
              const step = () => (++frames === 6 ? resolve() : requestAnimationFrame(step));
              requestAnimationFrame(step);
            }),
        );
      };
      await switchView("short", "short");
      await switchView("tall", "tall");
      assert.deepEqual(
        await page.evaluate(() => window.__overlaps),
        [],
        "First switch has no overlapping frame",
      );
      // Save a detached reading position, then switch away and restore it.
      const readingTop = await page.evaluate(async () => {
        window.__captureOverlaps = false;
        window.__scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
        window.__scroll.scrollTop = 400;
        window.__scroll.dispatchEvent(new Event("scroll"));
        // Let newly exposed history rows finish their normal scroll-time measurement.
        await new Promise((resolve) => {
          let frames = 0;
          const step = () => (++frames === 18 ? resolve() : requestAnimationFrame(step));
          requestAnimationFrame(step);
        });
        window.__captureOverlaps = true;
        return window.__scroll.scrollTop;
      });
      await switchView("short", "short");
      await switchView("tall", "tall");
      const restoredTop = await page.evaluate(() => window.__scroll.scrollTop);
      assert.ok(
        Math.abs(restoredTop - readingTop) <= 2,
        `Switch restores detached reading position: ${readingTop} -> ${restoredTop}`,
      );
      await switchView("draft", "empty");
      await switchView("delayed", "empty");
      await switchView("delayed", "tall");
      // Same count but different turn IDs, followed by an overlapping shifted history window.
      await switchView("delayed", "shifted");
      await page.evaluate(async () => {
        window.__captureOverlaps = false;
        window.__scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
        window.__scroll.scrollTop = 400;
        window.__scroll.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => {
          let frames = 0;
          const step = () => (++frames === 18 ? resolve() : requestAnimationFrame(step));
          requestAnimationFrame(step);
        });
        window.__captureOverlaps = true;
        window.__allowOlder();
      });
      await page.waitForFunction(
        () => document.querySelector("[data-ready]")?.getAttribute("data-allow-older") === "true",
      );
      const anchor = await page.evaluate(() => {
        const viewport = window.__scroll.getBoundingClientRect();
        const node = [
          ...document.querySelectorAll("[data-v4-timeline-virtual-history] > [data-v4-turn-unit]"),
        ].find((node) => node.getBoundingClientRect().bottom > viewport.top);
        const anchor = { id: node.dataset.turnId, top: node.getBoundingClientRect().top };
        window.__scroll.dispatchEvent(new Event("scroll"));
        return anchor;
      });
      await page.waitForFunction(
        () => document.querySelector("[data-ready]")?.getAttribute("data-kind") === "prepend",
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const anchorTop = await page
        .locator(`[data-v4-turn-unit][data-turn-id="${anchor.id}"]`)
        .evaluate((node) => node.getBoundingClientRect().top);
      assert.ok(
        Math.abs(anchorTop - anchor.top) <= 2,
        `Prepend preserves visible turn anchor: ${anchor.top} -> ${anchorTop}`,
      );
      await switchView("running", "running");
      await switchView("running", "tall");
      await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`) });
      const result = await page.evaluate(() => {
        window.__captureFrames = false;
        return {
          overlaps: window.__overlaps,
          frames: window.__frames.length,
          composerStable:
            window.__composer === document.querySelector('[data-testid="persistent-composer"]'),
          scrollStable: window.__scroll === document.querySelector("[data-v4-timeline-scroll]"),
          draft: window.__composer.value,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      assert.deepEqual(result.overlaps, [], `${width}/${theme}: no visible frame overlaps`);
      assert.ok(result.frames >= 60, "Sampled every switch at paint opportunities");
      assert.equal(result.composerStable, true);
      assert.equal(result.scrollStable, true);
      assert.equal(result.draft, "retained draft");
      assert.equal(result.overflow, false);
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}/${theme}: ${result.frames} frames, no overlaps, retained DOM/draft/scroll.`,
      );
      await page.close();
    }
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
