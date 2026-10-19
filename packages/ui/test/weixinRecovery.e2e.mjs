// Production settings components; synthetic runtime only, no real accounts or messages.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__weixin-recovery-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-weixin-recovery-"));
let server;
let browser;
try {
  await writeFile(
    html,
    `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ProviderSettingsCard} from '../../../ui/src/BotsDialog/ProviderSettingsCard.tsx';
    import {BotSummaryCard} from '../../../ui/src/BotsDialog/BotSummaryCard.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const locale=new URLSearchParams(location.search).get('locale')||'zh-CN';
    const bot={id:'synthetic',name:'Synthetic',provider:'weixin',enabled:true,credentialRef:'fixture',providerUserId:'bot-user',allowedWorkspaces:['*'],allowedCommands:{},currentOptions:{},replyMode:'summary_changes'};
    const s:any={scans:0,theme:applyTheme};window.__fixture=s;
    function Fixture(){
      const [runtime,setRuntime]=useState<any>({botId:bot.id,provider:'weixin',status:'polling',messageId:'bots.runtime.weixinLongPollingRunning'});
      const [registration,setRegistration]=useState<any>(null);s.runtime=setRuntime;s.registration=setRegistration;
      const noop=()=>{};
      const scan=()=>{s.scans++;setRegistration({botId:bot.id,qrUrl:'https://example.invalid/fixture',qrDataUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160"%3E%3Crect width="160" height="160" fill="gray"/%3E%3C/svg%3E',status:'pending'})};
      return <main className='min-h-screen bg-background p-4 text-foreground'>
        <BotSummaryCard bot={bot} runtime={runtime} selectedBotDisplayName='Synthetic' selectedBotName='Synthetic' fallbackBotName='Bot' renaming={false} onStartRename={noop} onCommitNameDraft={noop} onNameDraftChange={noop} onNameInputKeyDown={noop} onPatchBot={noop}/>
        <ProviderSettingsCard bot={bot} runtime={runtime} credentialValue='' bindCode={null} bindExpired={false} bindRemainingMs={0} bindCountdownProgress={0} feishuRegistration={null} feishuRegistrationLoading={false} weixinRegistration={registration} weixinRegistrationLoading={false} weixinActivated={true} secretSaving={false} onCredentialValueChange={noop} onSaveSecret={noop} onRemoveSecret={noop} onOpenTelegramBotFather={noop} onStartWeixinRegistration={scan} onStartFeishuRegistration={noop} onCreateBindCode={noop} onUnbind={noop} onCopyBindCommand={noop}/>
        <span id='ready'>ready</span>
      </main>;
    }
    applyTheme('zai-light');createRoot(document.getElementById('root')!).render(<React.StrictMode><ZCodeIntlProvider initialLocale={locale}><Fixture/></ZCodeIntlProvider></React.StrictMode>);
  `,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 320]) {
    for (const locale of ["zh-CN", "en-US"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(12_000);
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/${name}.html?locale=${locale}`,
      );
      await page.locator("#ready").waitFor();
      const scanLabel = locale === "zh-CN" ? "重新扫码登录" : "Sign in again with QR code";
      const running = locale === "zh-CN" ? "微信长轮询运行中。" : "Weixin long polling is running.";
      await page.getByText(running, { exact: true }).waitFor();
      await page.evaluate(() =>
        window.__fixture.runtime({
          botId: "synthetic",
          provider: "weixin",
          status: "error",
          messageId: "bots.runtime.weixinReconnecting",
          message: "Weixin /getupdates failed: kind=network",
        }),
      );
      const retry =
        locale === "zh-CN"
          ? "微信连接暂时失败，正在自动重连；请检查网络。"
          : "Weixin connection failed temporarily. Reconnecting automatically; check your network.";
      await page.getByText(retry, { exact: true }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: scanLabel }).count(), 0);
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((value) => window.__fixture.theme(value), theme);
        await page.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}-retry.png`) });
      }
      await page.evaluate(() =>
        window.__fixture.runtime({
          botId: "synthetic",
          provider: "weixin",
          status: "error",
          messageId: "bots.runtime.weixinLoginRequired",
          message: "Weixin /getupdates failed: kind=api http=200 ret=-14",
        }),
      );
      await page.getByRole("button", { name: scanLabel }).click();
      assert.equal(await page.evaluate(() => window.__fixture.scans), 1);
      await page
        .getByRole("img", { name: locale === "zh-CN" ? "微信登录二维码" : "Weixin login QR code" })
        .waitFor();
      await page.evaluate(() => {
        window.__fixture.registration(null);
        window.__fixture.runtime({
          botId: "synthetic",
          provider: "weixin",
          status: "polling",
          messageId: "bots.runtime.weixinLongPollingRunning",
          deliveryError: "Weixin /sendmessage failed: kind=network",
          deliveryErrorMessageId: "bots.runtime.weixinDeliveryNetwork",
        });
      });
      await page.getByText(running, { exact: true }).waitFor();
      await page
        .getByRole("alert")
        .filter({
          hasText: locale === "zh-CN" ? "不会自动重发" : "will not be resent automatically",
        })
        .waitFor();
      await page.evaluate(() =>
        window.__fixture.runtime({
          botId: "synthetic",
          provider: "weixin",
          status: "polling",
          messageId: "bots.runtime.weixinLongPollingRunning",
          deliveryError: "Weixin /sendmessage failed: kind=api http=200 errcode=-14",
          deliveryErrorMessageId: "bots.runtime.weixinLoginRequired",
        }),
      );
      await page.getByRole("button", { name: scanLabel }).waitFor();
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((value) => window.__fixture.theme(value), theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}-login.png`) });
      }
      await page.evaluate(() =>
        window.__fixture.runtime({
          botId: "synthetic",
          provider: "weixin",
          status: "polling",
          messageId: "bots.runtime.weixinLongPollingRunning",
        }),
      );
      await page.getByRole("alert").waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    `PASS: Weixin reconnect, sign-in action/QR, separate delivery failure and recovery; desktop/mobile, zh/en, light/dark. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
