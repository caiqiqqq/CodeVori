// Real timeline, synthetic Host snapshots; no Agent or user-session writes.
// ZCODE_E2E_VITE_URL=http://localhost:5174 node packages/ui/test/acpWorkDuration.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-work-duration-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "acp-work-duration-"));
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
      const start=Date.now()-3000;
      function Fixture(){
        const [snapshot,setSnapshot]=useState({status:'running',entries:[{id:'user:one',kind:'user',text:'计时问题',createdAt:start}]});
        const [epoch,setEpoch]=useState(0);
        const [api,setApi]=useState(false);
        const finish=()=>setSnapshot({status:'idle',entries:[{...snapshot.entries[0],endedAt:start+7000},{id:'assistant:one',kind:'assistant',text:'计时完成'}]});
        const replay=()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)};
        const legacy=()=>{setApi(false);setSnapshot({status:'running',entries:[{id:'user:old',kind:'user',text:'无时间旧记录'}]});setEpoch(e=>e+1)};
        const recover=()=>{setApi(false);setSnapshot({status:'interrupted',entries:[{id:'user:recovered',kind:'user',text:'恢复后终止',createdAt:start},{id:'assistant:recovered',kind:'assistant',text:'恢复前部分回复'}]});setEpoch(e=>e+1)};
        const rows=buildAcpConversationRows(snapshot as never);
        if(api && rows[0]?.kind==='turnHeader') rows[0].activeMs=2000;
        return <main className="h-screen flex flex-col bg-background text-foreground">
          <nav><button onClick={finish}>完成</button><button onClick={replay}>恢复快照</button><button onClick={legacy}>旧记录</button><button onClick={recover}>恢复中断</button><button onClick={()=>{finish();setApi(true)}}>API 对照</button></nav>
          <ConversationTimeline key={epoch} sessionKey={'duration-'+epoch} rows={rows} totalCount={rows.length} hideTurnNavigator
            rowContext={{workspacePath:'/fixture/duration',theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture'}}/>
        </main>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isMacOS:false,isWindows:false,isLinux:false,isWeb:true} as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const [width, theme] of [
    [1280, "theme-zai-light"],
    [390, "theme-zai-dark"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174"}/${name}.html`);
    await page.evaluate((theme) => document.documentElement.classList.add(theme), theme);
    const timeline = page.getByTestId("v4-timeline");
    await timeline.getByText(/工作中 \d+ 秒/).waitFor();
    const first = await timeline.getByText(/工作中 \d+ 秒/).innerText();
    await page.waitForFunction((first) => {
      const text = document.querySelector('[data-testid="v4-timeline"]')?.textContent ?? "";
      const label = text.match(/工作中 \d+ 秒/)?.[0];
      return label && label !== first;
    }, first);
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await timeline.getByText("已工作 7 秒", { exact: true }).waitFor();
    await page.clock.install();
    await page.clock.fastForward(5000);
    assert.equal(await timeline.getByText("已工作 7 秒", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "恢复快照" }).click();
    await timeline.getByText("已工作 7 秒", { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, `${width}-completed.png`) });
    await page.getByRole("button", { name: "旧记录", exact: true }).click();
    await timeline.getByText("无时间旧记录").waitFor();
    assert.equal(await timeline.getByText(/工作中 \d/).count(), 0);
    await page.getByRole("button", { name: "恢复中断" }).click();
    await timeline.getByText("恢复后终止").waitFor();
    assert.equal(await timeline.getByText(/(?:工作中|已工作|已中断) \d/).count(), 0);
    await page.getByRole("button", { name: "API 对照" }).click();
    await timeline.getByText("已工作 2 秒", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    `ACP work duration E2E passed: live tick, fixed completion, replay, unknown legacy/recovery and API active time; artifacts=${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
