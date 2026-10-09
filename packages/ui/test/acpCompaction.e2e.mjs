// Actual shared timeline, synthetic Host snapshots, no live Agent/model calls.
// ZCODE_E2E_BASE_URL=http://localhost:5174 node packages/ui/test/acpCompaction.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-compaction-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-compaction-e2e-"));
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
      function Fixture(){
        const [snapshot,setSnapshot]=useState({status:'running',entries:[
          {id:'user:fixture',kind:'user',text:'Compact fixture'},
          {id:'tool:fixture:read',kind:'tool',title:'Read fixture',status:'completed'},
          {id:'compaction:fixture:x',kind:'compaction',status:'running'},
        ]});
        const [epoch,setEpoch]=useState(0);
        window.__compaction={
          terminal:(status,origin)=>setSnapshot(s=>({...s,status:'idle',entries:s.entries.map(e=>e.kind==='compaction'?{...e,status,origin}:e)})),
          replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
        };
        const rows=buildAcpConversationRows(snapshot as never);
        return <div className="h-screen flex flex-col bg-background text-foreground" data-fixture-ready="true" data-fixture-epoch={epoch}>
          <ConversationTimeline key={epoch} sessionKey={'compact-fixture-'+epoch} rows={rows} totalCount={rows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',
              codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch}} />
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
      for (const [status, origin, label] of [
        ["success", undefined, "上下文已压缩"],
        ["success", "auto", "上下文已自动压缩"],
        ["failed", undefined, "上下文压缩失败"],
        ["cancelled", undefined, "上下文压缩已中断"],
      ]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(
          `${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`,
        );
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
        const marker = page.locator('[data-marker-type="compact"]');
        await marker.filter({ hasText: "正在压缩上下文" }).waitFor();
        assert.equal(await marker.getAttribute("data-status"), "running");
        assert.equal(await marker.locator(".animated-gradient-text").count(), 1);
        assert.equal(await marker.getAttribute("data-row-id"), "6");
        await page.evaluate(
          ([status, origin]) => window.__compaction.terminal(status, origin),
          [status, origin],
        );
        await openHistory();
        await marker.filter({ hasText: label }).waitFor();
        assert.equal(await marker.getAttribute("data-status"), status);
        assert.equal(await marker.locator(".animated-gradient-text").count(), 0);
        await page.evaluate(() => window.__compaction.replay());
        await page.locator('[data-fixture-epoch="1"]').waitFor();
        await openHistory();
        await marker.filter({ hasText: label }).waitFor();
        assert.equal(await marker.count(), 1);
        assert.equal(await marker.getAttribute("data-row-id"), "6");
        const tool = page.locator('[data-testid^="tool-summary-trigger-"]');
        await tool.waitFor();
        assert.equal(await tool.count(), 1);
        assert.match(await tool.innerText(), /Read fixture/);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        if (status === "success" && origin === undefined)
          await page.screenshot({
            path: join(artifacts, `completed-${width}-${theme}.png`),
            animations: "disabled",
          });
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  }
  console.log(
    `ACP compaction E2E passed: desktop/mobile, light/dark, lifecycle/replay. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
