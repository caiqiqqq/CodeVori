// Run with the desktop renderer Vite server: ZCODE_E2E_BASE_URL=http://localhost:5174 node <this file>.
// Synthetic Host snapshots only; no model calls or writes to saved conversations.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-reply-visibility-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-reply-visibility-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConversationTimeline} from '../../../ui/src/v4/ConversationTimeline.tsx';
    import {buildAcpConversationRows} from '../../../ui/src/v4/acpConversationRows.ts';
    import {conversationRowSchema} from '@zcode/shared/zcode-protocol-v4';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
    import '../../../ui/src/styles.css';
    const initial={status:'running',entries:[
      {id:'user:first',kind:'user',text:'Explain fixture'},
      {id:'thought:first',kind:'thought',text:'Inspect fixture',state:'complete'},
      {id:'assistant:first:answer',kind:'assistant',text:'Detailed **fixture answer** with instructions.'},
    ]};
    function Fixture(){
      const [snapshot,setSnapshot]=useState(initial);
      const [epoch,setEpoch]=useState(0);
      window.__replyVisibility={
        tools:()=>setSnapshot(s=>({...s,entries:[...s.entries,
          {id:'tool:first:read',kind:'tool',title:'Read fixture memory',status:'completed'},
          {id:'tool:first:edit',kind:'tool',title:'Edit fixture memory',status:'completed'}]})),
        reply:()=>setSnapshot(s=>({...s,entries:[...s.entries,{id:'assistant:first:summary',kind:'assistant',text:'Saved fixture summary.'}]})),
        finish:()=>setSnapshot(s=>({...s,status:'idle'})),
        next:()=>setSnapshot(s=>({...s,entries:[...s.entries,{id:'user:next',kind:'user',text:'Next fixture question'}]})),
        replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
      };
      const rows=JSON.parse(JSON.stringify(buildAcpConversationRows(snapshot as never))).map((row:unknown)=>conversationRowSchema.parse(row));
      return <div className="h-screen flex bg-background text-foreground" data-fixture-ready data-fixture-epoch={epoch}>
        <ConversationTimeline key={epoch} sessionKey={'reply-visibility-'+epoch} rows={rows} totalCount={rows.length}
          hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',
            codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch}} />
      </div>;
    }
    const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
      await page.locator("[data-fixture-ready]").waitFor();
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.add(
            `theme-${theme}`,
            ...(theme === "zai-dark" ? ["dark"] : []),
          ),
        theme,
      );
      const answer = page.locator('[data-row-id="6"]');
      const assertRepliesVisible = async () => {
        await answer.waitFor({ state: "visible" });
        await page
          .getByText("Saved fixture summary.", { exact: true })
          .waitFor({ state: "visible" });
        assert.equal(await answer.locator("strong").innerText(), "fixture answer");
        assert.equal(await answer.locator('[data-slot="collapsible-content"]').count(), 0);
        assert.equal(await page.locator('[data-row-id="6"]').count(), 1);
        assert.equal(
          await page.evaluate(() => {
            const row = document.querySelector('[data-row-id="6"]');
            return Boolean(row?.closest('[data-testid^="chat-assistant-history-content-"]'));
          }),
          false,
        );
      };
      await answer.waitFor({ state: "visible" });
      await page.evaluate(() => window.__replyVisibility.tools());
      await page.getByText("Read fixture memory", { exact: true }).waitFor();
      await answer.waitFor({ state: "visible" });
      await page.evaluate(() => window.__replyVisibility.reply());
      await assertRepliesVisible();
      await page.evaluate(() => window.__replyVisibility.finish());
      const history = page.locator('[data-testid^="chat-assistant-history-trigger-"]').first();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid^="chat-assistant-history-trigger-"]')
            ?.getAttribute("data-history-open") === "false",
      );
      await assertRepliesVisible();
      assert.equal(await page.getByText("Read fixture memory", { exact: true }).isVisible(), false);
      await history.click();
      await page.getByText("Read fixture memory", { exact: true }).waitFor({ state: "visible" });
      await assertRepliesVisible();
      await history.click();
      await assertRepliesVisible();
      await page.evaluate(() => window.__replyVisibility.next());
      await page.getByText("Next fixture question", { exact: true }).waitFor();
      await assertRepliesVisible();
      await page.evaluate(() => window.__replyVisibility.replay());
      await page.locator('[data-fixture-epoch="1"]').waitFor();
      await assertRepliesVisible();
      assert.equal(await page.getByText("Read fixture memory", { exact: true }).isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(artifacts, `replies-${width}-${theme}.png`) });
      await page.close();
    }
  }
  console.log(
    `PASS: ACP reply visibility across tools, collapse, next turn and replay; desktop/mobile, light/dark. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
