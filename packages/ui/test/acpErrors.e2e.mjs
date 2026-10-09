// Shared API error banners on ACP Host snapshots; no live model requests.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-errors-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-acp-errors-e2e-"));
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
      import {AcpConversationStatus,AcpHomeStatus} from '../../../ui/src/v4/AcpConversationContent.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {DEFAULT_CODE_PREVIEW_SETTINGS} from '../../../ui/src/lib/codePreviewSettings.ts';
      import '../../../ui/src/styles.css';
      const title='stream disconnected before completion: idle timeout waiting for SSE';
      const failure={id:'incident',revision:1,category:'connection',severity:'error',title,details:'Provider stream ended early',actions:['retry']};
      function Fixture(){
        const [snapshot,setSnapshot]=useState({status:'running',error:null,entries:[{id:'user:fixture',kind:'user',text:'Inspect fixture'},{id:'assistant:fixture',kind:'assistant',text:'Partial answer'}]});
        const [epoch,setEpoch]=useState(0);
        const [home,setHome]=useState(false);
        const [operation,setOperation]=useState(null);
        const [retries,setRetries]=useState(0);
        window.__errors={
          fail:()=>setSnapshot(s=>({...s,status:'interrupted',error:title,entries:s.entries.map(e=>e.kind==='user'?{...e,traceError:title,failures:[failure]}:e)})),
          next:()=>setSnapshot(s=>({...s,status:'idle',error:null,entries:[...s.entries,{id:'user:next',kind:'user',text:'Next fixture question'},{id:'assistant:next',kind:'assistant',text:'Successful later answer'}]})),
          replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
          home:()=>{setHome(true);setOperation('Connection fixture error')},
          permission:()=>setSnapshot(s=>({...s,pendingPermission:{requestId:'permission',title:'Fixture permission',options:[{optionId:'allow',name:'Allow fixture'}]}})),
          operation:()=>setOperation('Unaccepted operation error'),
        };
        const conversation={selected:home?null:snapshot,error:operation,busy:false,retryConnection:()=>setRetries(n=>n+1),dismissError:()=>setOperation(null),decide:()=>setSnapshot(s=>({...s,pendingPermission:null}))};
        const rows=buildAcpConversationRows(snapshot as never);
        return <div className="relative h-screen flex flex-col bg-background text-foreground" data-fixture-ready="true" data-fixture-epoch={epoch} data-retries={retries}>
          {home?<AcpHomeStatus agent="codex" conversation={conversation as never}/>:<ConversationTimeline key={epoch} sessionKey={'error-fixture-'+epoch} rows={rows} totalCount={rows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch}}
            footerSlot={<AcpConversationStatus agent="codex" conversation={conversation as never}/>}/>}
        </div>;
      }
      const platform={isMacOS:false,isWindows:false,isLinux:false,isWeb:true};
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={{} as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  const baseUrl = process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174";
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/${name}.html`);
      await page.locator('[data-fixture-ready="true"]').waitFor();
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.add(
            `theme-${theme}`,
            ...(theme === "zai-dark" ? ["dark"] : []),
          ),
        theme,
      );
      assert.equal(await page.locator("[data-conversation-notice]").count(), 0);
      await page.evaluate(() => window.__errors.fail());
      const notice = page.locator('[data-conversation-notice="incident"]');
      await notice.waitFor();
      const banner = notice.locator('[data-error-code="ACP_SESSION_FAILED"]');
      assert.match(await banner.innerText(), /idle timeout waiting for SSE/);
      assert.equal(
        await page.locator('[data-error-code="ACP_SESSION_FAILED"]').count(),
        1,
        "footer must not duplicate saved error",
      );
      await banner.getByRole("button", { name: "复制", exact: true }).click();
      await page.waitForFunction(async () =>
        (await navigator.clipboard.readText()).includes("Provider stream ended early"),
      );
      await banner.getByRole("button", { name: "展开详情", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Provider stream ended early/);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      // 本轮已有保存错误，新的未接纳操作错误仍需显示；不能误被 footer 去重隐藏。
      await page.evaluate(() => window.__errors.operation());
      const operationBanner = page.locator('[data-error-code="ACP_OPERATION_FAILED"]');
      await operationBanner.waitFor();
      await operationBanner.getByRole("button", { name: "关闭错误提示", exact: true }).click();
      await operationBanner.waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.next());
      await page.getByText("Successful later answer", { exact: true }).waitFor();
      await notice.waitFor();
      const historicalTurn = notice.locator("xpath=ancestor::section[1]");
      assert.match(await historicalTurn.innerText(), /Inspect fixture/);
      assert.doesNotMatch(await historicalTurn.innerText(), /Next fixture question/);
      await page.evaluate(() => window.__errors.replay());
      await page.locator('[data-fixture-epoch="1"]').waitFor();
      await notice.waitFor();
      assert.equal(await page.locator("[data-conversation-notice]").count(), 1);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      await page.screenshot({
        path: join(artifacts, `replay-${width}-${theme}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => window.__errors.permission());
      await page.getByRole("button", { name: "Allow fixture", exact: true }).click();
      await page.getByTestId("acp-permission").waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.operation());
      await page.locator('[data-error-code="ACP_OPERATION_FAILED"]').waitFor();
      await page
        .locator('[data-error-code="ACP_OPERATION_FAILED"]')
        .getByRole("button", { name: "关闭错误提示", exact: true })
        .click();
      await page.locator('[data-error-code="ACP_OPERATION_FAILED"]').waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.home());
      const home = page.locator('[data-error-code="ACP_CONNECTION_FAILED"]');
      await home.waitFor();
      await home.getByRole("button", { name: "重试", exact: true }).click();
      await page.locator('[data-retries="1"]').waitFor();
      await home.getByRole("button", { name: "关闭错误提示", exact: true }).click();
      await home.waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log(
    `ACP errors E2E passed: desktop/mobile, light/dark, details/copy/replay/operation/permission. Artifacts: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
