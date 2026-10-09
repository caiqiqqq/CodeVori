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
      import {SessionSubscriptionErrorPanel} from '../../../ui/src/v4/SessionSubscriptionErrorPanel.tsx';
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
        const [subscription,setSubscription]=useState(false);
        const [away,setAway]=useState(false);
        window.__errors={
          leave:()=>setAway(true),
          enter:()=>setAway(false),
          subscription:()=>setSubscription(true),
          warn:(title='Heads up: Long threads and multiple compactions',id='incident')=>setSnapshot(s=>({...s,status:'running',entries:s.entries.map(e=>e.kind==='user'?{...e,failures:[{...failure,id,severity:'warning',title}]}:e)})),
          progress:()=>setSnapshot(s=>({...s,entries:s.entries.map(e=>e.kind==='assistant'?{...e,text:e.text+' resumed'}:e)})),
          finish:()=>setSnapshot(s=>({...s,status:'idle'})),
          render:()=>setSnapshot(s=>structuredClone(s)),
          fail:()=>setSnapshot(s=>({...s,status:'interrupted',error:title,entries:s.entries.map(e=>e.kind==='user'?{...e,traceError:title,failures:[failure]}:e)})),
          recover:(overlay=false)=>{const error='ACP Agent 已断开，请重试发送新的消息。';setSnapshot(s=>({...s,status:'interrupted',error,entries:s.entries.map(e=>{if(e.kind!=='user')return e;const {traceError,failures,...entry}=e;return entry})}));setOperation(overlay?error:null)},
          next:()=>setSnapshot(s=>({...s,status:'idle',error:null,entries:[...s.entries,{id:'user:next',kind:'user',text:'Next fixture question'},{id:'assistant:next',kind:'assistant',text:'Successful later answer'}]})),
          replay:()=>{setSnapshot(s=>structuredClone(s));setEpoch(e=>e+1)},
          home:()=>{setHome(true);setOperation('Connection fixture error')},
          permission:()=>setSnapshot(s=>({...s,pendingPermission:{requestId:'permission',title:'Fixture permission',options:[{optionId:'allow',name:'Allow fixture'}]}})),
          operation:()=>setOperation('Unaccepted operation error'),
        };
        const conversation={selected:home?null:snapshot,error:operation,busy:false,retryConnection:()=>setRetries(n=>n+1),dismissError:()=>setOperation(null),decide:()=>setSnapshot(s=>({...s,pendingPermission:null}))};
        const rows=buildAcpConversationRows(snapshot as never);
        return <div data-session-id="error-fixture" style={{height:'80vh',width:innerWidth>600?'55vw':'100vw',marginTop:'10vh',marginLeft:innerWidth>600?'5vw':0}} className="relative flex flex-col bg-background text-foreground" data-fixture-ready="true" data-fixture-epoch={epoch} data-retries={retries}>
          {away?null:subscription?<SessionSubscriptionErrorPanel error="Subscription fixture error" onReconnect={()=>{setRetries(n=>n+1);setSubscription(false)}}/>:home?<AcpHomeStatus agent="codex" conversation={conversation as never}/>:<ConversationTimeline key={epoch} sessionKey="error-fixture" rows={rows} totalCount={rows.length}
            hideTurnNavigator workDurationAvailable={false} rowContext={{workspacePath:'/synthetic/project',theme:'zai-light',codePreviewSettings:DEFAULT_CODE_PREVIEW_SETTINGS,logEpoch:'fixture-'+epoch}}
            footerSlot={<AcpConversationStatus agent="codex" conversation={conversation as never} rows={rows}/>}/>}
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
      page.setDefaultNavigationTimeout(120_000);
      page.setDefaultTimeout(90_000);
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
      await page.clock.install();
      await page.evaluate(() => window.__errors.warn());
      const warning = page.locator('[data-notice-severity="warning"]');
      await warning.waitFor();
      assert.equal(await warning.getByRole("button", { name: "反馈问题", exact: true }).count(), 0);
      await page.clock.fastForward(3000);
      await page.evaluate(() => window.__errors.render());
      await warning.waitFor();
      await page.clock.fastForward(2100);
      await warning.waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.render());
      assert.equal(await warning.count(), 0, "unrelated render must not resurrect warning");
      // 观察 DOM 插入，防止先闪现再由 effect 隐藏，普通 count 检查会漏掉这种回归。
      await page.evaluate(() => {
        window.__warningInsertions = 0;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (
                node instanceof Element &&
                (node.matches('[data-notice-severity="warning"]') ||
                  node.querySelector('[data-notice-severity="warning"]'))
              ) {
                window.__warningInsertions++;
              }
            }
          }
        }).observe(document.getElementById("root"), { subtree: true, childList: true });
      });
      const reenterWithoutWarning = async (replay = false) => {
        await page.evaluate(() => {
          window.__warningInsertions = 0;
          window.__errors.leave();
        });
        await page.locator('[data-v4-timeline-scroll="true"]').waitFor({ state: "detached" });
        await page.evaluate((replay) => {
          if (replay) window.__errors.replay();
          window.__errors.enter();
        }, replay);
        await page.getByText("Partial answer", { exact: true }).waitFor();
        assert.equal(await warning.count(), 0, "re-entry must not resurrect warning");
        assert.equal(
          await page.evaluate(() => window.__warningInsertions),
          0,
          "no first-frame flash",
        );
      };
      await reenterWithoutWarning();
      await reenterWithoutWarning(true);
      // 新事件即使文案相同仍展示；在离开期间到期不能重启五秒计时。
      await page.evaluate(() => window.__errors.warn(undefined, "next-incident"));
      await warning.waitFor();
      await page.clock.fastForward(3000);
      await page.evaluate(() => window.__errors.leave());
      await warning.waitFor({ state: "detached" });
      await page.clock.fastForward(1000);
      await page.evaluate(() => window.__errors.enter());
      await warning.waitFor();
      await page.clock.fastForward(1100);
      await warning.waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.warn("Away deadline", "away-incident"));
      await warning.waitFor();
      await page.evaluate(() => window.__errors.leave());
      await warning.waitFor({ state: "detached" });
      await page.clock.fastForward(5100);
      await reenterWithoutWarning();
      await page.evaluate(() => window.__errors.warn("Reconnecting... 1/5"));
      await warning.waitFor();
      await page.evaluate(() => window.__errors.progress());
      await warning.waitFor({ state: "detached" });
      await page.evaluate(() => window.__errors.replay());
      await page.getByText("Partial answer resumed", { exact: true }).waitFor();
      assert.equal(await warning.count(), 0, "recovery dismissal survives replay");
      await page.evaluate(() => window.__errors.warn("Reconnecting... 2/5"));
      await warning.waitFor();
      await page.evaluate(() => window.__errors.finish());
      await warning.waitFor({ state: "detached" });
      await page.clock.resume();
      // 重启恢复只有 session.error；桌面与手机回放都只能保留轮尾的一条提示。
      for (const overlay of [false, true]) {
        await page.evaluate((overlay) => window.__errors.recover(overlay), overlay);
        const disconnect = page.getByText("ACP Agent 已断开，请重试发送新的消息。", {
          exact: true,
        });
        await disconnect.waitFor();
        assert.equal(await disconnect.count(), 1);
        assert.equal(await page.locator('[data-error-code="ACP_OPERATION_FAILED"]').count(), 0);
        await page.evaluate(() => window.__errors.render());
        assert.equal(await disconnect.count(), 1, "snapshot replay must not duplicate disconnect");
      }
      await page.evaluate(() => window.__errors.operation());
      const recoveredOperation = page.locator('[data-error-code="ACP_OPERATION_FAILED"]');
      await recoveredOperation.waitFor();
      await recoveredOperation.getByRole("button", { name: "关闭错误提示", exact: true }).click();
      await recoveredOperation.waitFor({ state: "detached" });
      await page.getByText("ACP Agent 已断开，请重试发送新的消息。", { exact: true }).waitFor();
      await page.evaluate(() => window.__errors.fail());
      const notice = page.locator('[data-conversation-notice="incident"]');
      await notice.waitFor();
      const banner = notice.locator('[data-error-code="ACP_SESSION_FAILED"]');
      assert.match(await banner.innerText(), /idle timeout waiting for SSE/);
      assert.equal(await banner.getByRole("button", { name: "反馈问题", exact: true }).count(), 0);
      assert.equal(
        await page.locator('[data-error-code="ACP_SESSION_FAILED"]').count(),
        1,
        "footer must not duplicate saved error",
      );
      await page.evaluate(() => {
        window.__originalClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (text) =>
          new Promise((resolve, reject) => {
            window.__finishCopy = () => window.__originalClipboardWrite(text).then(resolve, reject);
          });
      });
      await banner.getByRole("button", { name: "复制", exact: true }).click();
      // 剪贴板仍在等待时，把焦点移到另一会话，反馈仍属于来源窗格。
      await page.evaluate(async () => {
        const otherPane = document.createElement("div");
        otherPane.dataset.sessionId = "other-fixture";
        otherPane.style.cssText =
          "position:fixed;right:0;top:0;width:25vw;height:100vh;pointer-events:none";
        const focusTarget = document.createElement("button");
        otherPane.append(focusTarget);
        document.body.append(otherPane);
        focusTarget.focus();
        await window.__finishCopy();
        navigator.clipboard.writeText = window.__originalClipboardWrite;
      });
      await page.waitForFunction(async () =>
        (await navigator.clipboard.readText()).includes("Provider stream ended early"),
      );
      const copyToast = page.getByText("已复制完整报错信息", { exact: true });
      await copyToast.waitFor();
      const assertCentered = async (toast) => {
        const paneBox = await page.locator('[data-session-id="error-fixture"]').boundingBox();
        const toastBox = await toast.boundingBox();
        assert.ok(paneBox && toastBox);
        assert.ok(Math.abs(toastBox.x + toastBox.width / 2 - paneBox.x - paneBox.width / 2) < 2);
        assert.ok(Math.abs(toastBox.y + toastBox.height / 2 - paneBox.y - paneBox.height / 2) < 2);
        assert.ok(
          toastBox.x >= paneBox.x && toastBox.x + toastBox.width <= paneBox.x + paneBox.width,
        );
      };
      // 等待进入动画完成，检查真正的几何位置而非 CSS 类名。
      await page.waitForFunction(
        () =>
          document.querySelector('[data-toast-position="center"]')?.firstElementChild &&
          getComputedStyle(
            document.querySelector('[data-toast-position="center"]').firstElementChild,
          ).opacity === "1",
      );
      await assertCentered(copyToast);
      await page.locator('[data-session-id="error-fixture"]').evaluate((pane) => {
        pane.style.height = "70vh";
      });
      await page.waitForFunction(() => {
        const pane = document
          .querySelector('[data-session-id="error-fixture"]')
          .getBoundingClientRect();
        const toast = document
          .querySelector('[data-toast-position="center"]')
          .getBoundingClientRect();
        return Math.abs(toast.y + toast.height / 2 - pane.y - pane.height / 2) < 2;
      });
      await assertCentered(copyToast);
      await page.screenshot({
        path: join(artifacts, `copy-${width}-${theme}.png`),
        animations: "disabled",
      });
      await copyToast.waitFor({ state: "detached" });
      await page.evaluate(() => {
        window.__originalClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async () => {
          throw new Error("Clipboard denied");
        };
      });
      await banner.getByRole("button", { name: "复制", exact: true }).click();
      const failureToast = page.getByText("复制报错信息失败：Clipboard denied", { exact: true });
      await failureToast.waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector('[data-toast-position="center"]').firstElementChild,
          ).opacity === "1",
      );
      await assertCentered(failureToast);
      await page.evaluate(() => {
        navigator.clipboard.writeText = window.__originalClipboardWrite;
      });
      await failureToast.waitFor({ state: "detached" });
      await page.evaluate(() =>
        document.querySelector('[data-session-id="other-fixture"]').remove(),
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
      await page.locator('[data-fixture-epoch="3"]').waitFor();
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
      await page.evaluate(() => window.__errors.subscription());
      await page.getByText("Subscription fixture error", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "反馈问题", exact: true }).count(), 0);
      await page.getByTestId("v4-retry-subscribe").click();
      await page
        .getByText("Subscription fixture error", { exact: true })
        .waitFor({ state: "detached" });
      await page.locator('[data-retries="2"]').waitFor();
      assert.deepEqual(errors, []);
      console.log(`ACP errors E2E passed: ${width}/${theme}`);
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
