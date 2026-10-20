// Real help menu and composer, synthetic Host only; no model calls or real user data.
// Run against desktop Vite: node packages/ui/test/productBranding.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__product-branding-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "codevori-branding-ui-"));
let browser;

try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {PRODUCT_NAME,PRODUCT_MARK_PATH,DesktopCommandIds,TID_WORKSPACE_HELP_MENU_TRIGGER} from '@zcode/shared';
    import {WorkspaceHelpMenuButton} from '../../../ui/src/WorkspaceHelpMenuButton.tsx';
    import {WindowsTopLeftLogo} from '../../../ui/src/WindowsTopLeftLogo.tsx';
    import {ZCodeAboutLogo} from '../../../ui/src/components/ui/ZCodeAboutLogo.tsx';
    import {ZCodeStartupLogoBadge} from '../../../ui/src/root/RootStartupLoading.tsx';
    import {ConversationDraftEmptyState} from '../../../ui/src/v4/ConversationDraftEmptyState.tsx';
    import {ChatPromptEditor} from '../../../ui/src/prompt-editor/ChatPromptEditor.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useFeedbackStore} from '../../../ui/src/feedback/feedbackStore.ts';
    import '../../../ui/src/styles.css';
    const locale=new URLSearchParams(location.search).get('locale')||'zh-CN';
    const state={calls:[],commands:[],issueReports:0,feedbackOpen:()=>useFeedbackStore.getState().open,mark:PRODUCT_MARK_PATH,about:DesktopCommandIds.ShowAbout,helpId:TID_WORKSPACE_HELP_MENU_TRIGGER};
    window.__branding=state;
    const services={
      zcodeAgentService:{getSkillReferenceCatalog:async()=>({authority:'workspace',skills:[]}),onAgentRuntimeRestarted:()=>({dispose(){}}),onDynamicSessionsIndexFrame:()=>()=>({dispose(){}}),onAgentRuntimeLifecycleChanged:()=>({dispose(){}})},
      zcodeSessionService:{list:async()=>[]},
      clientConfigService:{getSnapshot:async()=>({pluginStoreOrder:null})},
    };
    const platform={isMacOS:false,isWindows:true,isLinux:false,isWeb:false,
      executeDesktopCommand:async(command)=>state.commands.push(command),
      openFeedback:async()=>{state.issueReports++},
      getUpdateState:async()=>({enabled:false}),onUpdateStateChanged:()=>()=>{},
    };
    function Fixture(){
      const {intl}=useZCodeIntl();
      document.title=PRODUCT_NAME;
      return <main className="flex min-h-screen min-w-0 flex-col bg-background text-foreground p-4">
        <header className="relative flex h-16 shrink-0 items-center justify-end"><WindowsTopLeftLogo/><WorkspaceHelpMenuButton isDesktop/></header>
        <h1 data-testid="brand-welcome" className="text-ui-xl">{intl.formatMessage({id:'login.title'})}</h1>
        <p data-testid="brand-storage" className="text-ui-sm">{intl.formatMessage({id:'settings.dataBaseDirDescription'})}</p>
        <section className="flex items-center gap-4 py-4" data-testid="brand-icon-surfaces"><ZCodeStartupLogoBadge animated={false}/><ZCodeAboutLogo className="h-8 w-auto"/></section>
        <section className="relative mt-8" data-testid="brand-draft-icon"><ConversationDraftEmptyState/></section>
        <div className="mt-auto w-full max-w-2xl self-center"><ChatPromptEditor workspacePath="/synthetic/branding" taskId={null}
          placeholder={intl.formatMessage({id:'chat.placeholder.newTask'})} enableMentionPanel={false} enableSlashCommands={false}
          inputTestId="brand-editor" submitLabel="Send" onSubmit={value=>{state.calls.push(value);return true}}/></div>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<PlatformProvider platform={platform}><TabStoreProvider>
      <ServiceProvider services={services}><ZCodeIntlProvider initialLocale={locale}><TooltipProvider><Fixture/></TooltipProvider>
      </ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  for (const locale of ["zh-CN", "en-US"]) {
    for (const width of [1280, 375]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        page.setDefaultTimeout(12000);
        await page.emulateMedia({ colorScheme: theme });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.route("**/*", (route) =>
            new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
          );
          await page.goto(`${origin}/${name}.html?locale=${locale}`);
          await page.getByTestId("brand-editor").waitFor();
          await page.evaluate((value) => {
            document.documentElement.className =
              value === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
          }, theme);
          assert.equal(await page.title(), "CodeVori");
          assert.match(await page.getByTestId("brand-welcome").innerText(), /CodeVori/);
          assert.match(await page.getByTestId("brand-storage").innerText(), /\.zcode\/v2/);
          assert.equal(await page.getByAltText("CodeVori").count(), 1);
          const appImage = page.getByAltText("CodeVori");
          const mark = await page.evaluate(() => window.__branding.mark);
          // Vite 可以内嵌小 SVG；验证实际字形，不依赖构建产物的 URL 形式。
          const appSvg = await appImage.evaluate(async (image) =>
            (await fetch(image.currentSrc || image.src)).text(),
          );
          assert.ok(appSvg.includes(mark));
          assert.equal(
            await appImage.evaluate(async (image) => {
              await image.decode();
              return image.complete && image.naturalWidth > 0;
            }),
            true,
          );
          for (const path of await page.getByTestId("brand-icon-surfaces").locator("path").all())
            assert.equal(await path.getAttribute("d"), mark);
          const draft = page.getByTestId("brand-draft-icon");
          assert.equal(await draft.locator("svg path").getAttribute("d"), mark);
          assert.equal(await draft.locator("svg").isVisible(), theme === "light");
          const darkImage = draft.locator('[data-v4-draft-logo="dark"]');
          assert.equal(await darkImage.isVisible(), theme === "dark");
          assert.equal(
            await darkImage.evaluate(async (image) => {
              await image.decode();
              return image.complete && image.naturalWidth > 0;
            }),
            true,
          );
          const editor = page.getByTestId("brand-editor");
          assert.match(await editor.getAttribute("aria-placeholder"), /CodeVori/);
          const helpId = await page.evaluate(() => window.__branding.helpId);
          await page.getByTestId(helpId).click();
          const about = page.getByRole("menuitem", {
            name: locale === "zh-CN" ? "关于 CodeVori" : "About CodeVori",
            exact: true,
          });
          await about.waitFor();
          await page.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}.png`) });
          await about.click();
          assert.equal(
            await page.evaluate(() => window.__branding.commands.at(-1)),
            await page.evaluate(() => window.__branding.about),
          );
          await about.waitFor({ state: "hidden" });
          await page.getByTestId(helpId).click();
          const issueReport = page.getByRole("menuitem", {
            name: locale === "zh-CN" ? "问题上报" : "Report an issue",
            exact: true,
          });
          await issueReport.click();
          await page.waitForFunction(() => window.__branding.issueReports === 1);
          await issueReport.waitFor({ state: "detached" });
          assert.equal(await issueReport.count(), 0);
          assert.equal(await page.evaluate(() => window.__branding.feedbackOpen()), false);
          await editor.fill("Branding keeps the composer working");
          await editor.press("Enter");
          await page.waitForFunction(() => window.__branding.calls.length === 1);
          assert.deepEqual(await page.evaluate(() => window.__branding.calls), [
            "Branding keeps the composer working",
          ]);
          assert.deepEqual(errors, []);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
        } finally {
          await page.close();
        }
      }
    }
  }
  process.stdout.write(
    `PASS: CodeVori menu, issue-report routing and composer in both languages, widths and themes. ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
