// Real timeline + tool renderers, synthetic snapshots, no Host or model writes.
// ZCODE_E2E_BASE_URL=http://localhost:5174 node packages/ui/test/acpToolGrouping.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-tool-grouping-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "codevori-acp-tools-"));
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
      import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
      import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      const services={};
      const command=id=>"python3 - <<'PY'\\n"+('print("long command '+id+'")\\n').repeat(20)+'PY';
      const entry=(id,kind='execute',status='completed')=>({id,kind:'tool',toolKind:kind,
        title:command(id),input:JSON.stringify({cmd:command(id)}),status,content:'reported result '+id});
      const seed=()=>[entry('a'),entry('b','execute','in_progress')];
      function Fixture(){
        const [snapshot,setSnapshot]=useState({status:'running',entries:seed()});
        const [api,setApi]=useState(false);
        const [grouping,setGrouping]=useState(true);
        const [epoch,setEpoch]=useState(0);
        window.__tools={
          append:()=>setSnapshot(s=>({...s,entries:[...s.entries.map(e=>({...e,status:'completed'})),entry('c','execute','in_progress')]})),
          finish:()=>setSnapshot(s=>({status:'idle',entries:s.entries.map(e=>({...e,status:e.id==='b'?'failed':'completed',content:e.id==='b'?'failed output':e.content}))})),
          replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
          reset:(kind='execute')=>{setApi(false);setGrouping(true);setEpoch(e=>e+1);setSnapshot({status:'running',entries:[entry('a',kind),entry('b',kind,'in_progress')]})},
          unknown:()=>{setApi(false);setEpoch(e=>e+1);setSnapshot({status:'running',entries:[{...entry('legacy'),toolKind:undefined,title:'Task '+command('legacy')}]})},
          interrupt:()=>setSnapshot(s=>({...s,status:'interrupted'})),
          grouping:setGrouping, api:()=>{setApi(true);setEpoch(e=>e+1)},
        };
        const entries=[{id:'user:first',kind:'user',text:api?'API tool presentation':'ACP tool presentation'},...snapshot.entries];
        const rows=buildAcpConversationRows({...snapshot,entries});
        const displayRows=api?rows.map(row=>row.kind==='toolCall'?{...row,toolName:'Bash',input:{command:row.inputText}}:row):rows;
        return <div className="h-screen flex flex-col bg-background text-foreground" data-fixture-ready="true">
          <ConversationTimeline key={epoch} sessionKey={'tool-fixture-'+epoch} rows={displayRows} totalCount={displayRows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',
              codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch,toolGroupingExploreEnabled:grouping,toolGroupingTerminalEnabled:grouping}} />
        </div>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    await page.locator('[data-fixture-ready="true"]').waitFor();
    await page.evaluate(() => document.documentElement.classList.add("theme-zai-light"));
    const triggers = page.locator('[data-testid^="tool-summary-trigger-"]');
    const history = page.locator('[data-testid^="chat-assistant-history-trigger-"]');
    const openHistory = async () => {
      if (
        (await history.count()) &&
        (await history.first().getAttribute("data-history-open")) === "false"
      )
        await history.first().click();
    };
    const singleLine = async (locator) => {
      const box = await locator.boundingBox();
      assert.ok(
        box && box.height < 35,
        `summary must stay one line at ${width}px: ${JSON.stringify(box)}`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      return box;
    };
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 1,
    );
    const first = triggers.first();
    await singleLine(first);
    const key = await first.getAttribute("data-testid");
    await page.evaluate(() => {
      window.__sameSummary = document.querySelector('[data-testid^="tool-summary-trigger-"]');
      window.__tools.append();
    });
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid^="tool-summary-trigger-"]')
        ?.textContent.includes("long command c"),
    );
    assert.equal(await first.getAttribute("data-testid"), key);
    assert.equal(
      await page.evaluate(
        () =>
          window.__sameSummary === document.querySelector('[data-testid^="tool-summary-trigger-"]'),
      ),
      true,
    );
    await singleLine(first);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="collapsible-content"]')].every((element) =>
        element.getAnimations().every((animation) => animation.playState !== "running"),
      ),
    );
    await page.screenshot({ path: join(artifacts, `running-${width}.png`) });
    await page.evaluate(() => {
      document.documentElement.classList.remove("theme-zai-light");
      document.documentElement.classList.add("theme-zai-dark", "dark");
    });
    await singleLine(first);
    await page.screenshot({ path: join(artifacts, `running-dark-${width}.png`) });
    await first.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 4,
    );
    for (const trigger of await triggers.all()) await singleLine(trigger);
    const child = triggers.nth(1);
    await child.click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("pre")].some((el) =>
        el.textContent.includes("reported result a"),
      ),
    );
    assert.ok(
      await page
        .locator("pre")
        .filter({ hasText: "reported result a" })
        .innerText()
        .then((text) => text.includes('print("long command a")\n')),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="collapsible-content"]')].every((element) =>
        element.getAnimations().every((animation) => animation.playState !== "running"),
      ),
    );
    await page.locator("pre").filter({ hasText: "reported result a" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `expanded-${width}.png`) });
    await first.click();
    await page.evaluate(() => window.__tools.finish());
    await openHistory();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid^="tool-summary-trigger-"]')
        ?.textContent.includes("失败"),
    );
    assert.match(await triggers.first().innerText(), /1.*失败/);
    await singleLine(triggers.first());
    await page.evaluate(() => window.__tools.replay());
    await openHistory();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid^="tool-summary-trigger-"]')
        ?.textContent.includes("失败"),
    );
    assert.match(await triggers.first().innerText(), /1.*失败/);
    await page.evaluate(() => window.__tools.reset("read"));
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 1 &&
        document
          .querySelector('[data-testid^="tool-summary-trigger-"]')
          ?.textContent.includes("long command b"),
    );
    await singleLine(triggers.first());
    await page.evaluate(() => window.__tools.grouping(false));
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 2,
    );
    for (const trigger of await triggers.all()) await singleLine(trigger);
    await page.evaluate(() => window.__tools.unknown());
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 1 &&
        document
          .querySelector('[data-testid^="tool-summary-trigger-"]')
          ?.textContent.includes("Task"),
    );
    await singleLine(triggers.first());
    await page.evaluate(() => window.__tools.reset());
    await page.evaluate(() => window.__tools.interrupt());
    await openHistory();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid^="tool-summary-trigger-"]')
        ?.textContent.includes("停止"),
    );
    await singleLine(triggers.first());
    await page.evaluate(() => window.__tools.reset());
    await page.evaluate(() => window.__tools.api());
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="tool-summary-trigger-"]').length === 1,
    );
    await singleLine(triggers.first());
    await page.screenshot({ path: join(artifacts, `api-${width}.png`) });
    assert.deepEqual(errors, [], errors.join("\n"));
    await page.close();
  }
  console.log(
    `PASS: ACP/API single-line groups, live rollover, stable identity, keyboard expansion, details, failure/interruption/replay at 1280/375px. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
