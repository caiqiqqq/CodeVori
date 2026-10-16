// Real automation management page with an offline Host policy; no paid model calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__workflow-local-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
let server, browser;
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
    import {AutomationsSection} from '../../../ui/src/settings/AutomationsSection.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {useDynamicWorkflowAvailabilityLoader} from '../../../ui/src/hooks/useDynamicWorkflowAvailability.ts';
    import {resolveDynamicWorkflowClientConfig} from '../../../shared/src/dynamic-workflow-feature.ts';
    import '../../../ui/src/styles.css';
    const disabled = new URLSearchParams(location.search).has('disabled');
    const policy = resolveDynamicWorkflowClientConfig({env: disabled ? {ZCODE_DYNAMIC_WORKFLOW_MODE:'disabled'} : {}});
    window.__lists = 0;
    const codingPlanSubscriptionService = {
      getDynamicWorkflowClientConfig: async () => policy,
      getOffPeakClientConfig: async () => ({enabled:false}),
    };
    const services:any = {
      codingPlanSubscriptionService,
      settingService:{get:async()=>({}),update:async()=>{}},
      clientScenesService:{list:async()=>({code:0,data:[]})},
      offPeakTaskService:{list:async()=>[],getCodingPlanSupport:async()=>({supported:false})},
      zcodeAgentService:{
        listAllAutomations:async()=>[],
        listSavedWorkflows:async()=>{ window.__lists++; return {dir:null,workflows:[{name:'offline-review',description:'Offline saved workflow',scope:'global',path:'/synthetic/workflows/offline-review.ts'}],invalid:[]}; },
        listSavedWorkflowRuns:async()=>({runs:[]}),
      },
      fileWatcherService:{watch:async()=>({id:'watch'}),unwatch:async()=>{},onDynamicChange:()=>()=>({dispose(){}})},
    };
    const locale = new URLSearchParams(location.search).get('locale') ?? 'zh-CN';
    document.documentElement.classList.add(new URLSearchParams(location.search).get('theme') ?? 'zai-light');
    function Fixture(){
      useDynamicWorkflowAvailabilityLoader(codingPlanSubscriptionService as never);
      return <AutomationsSection workspacePath="/synthetic/project"/>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,onSettingsChanged:()=>()=>{}} as never}><ServiceProvider services={services}><TabStoreProvider><ZCodeIntlProvider initialLocale={locale}><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></TabStoreProvider></ServiceProvider></PlatformProvider>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19171, strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/${name}.html`;
  for (const width of [1280, 375]) {
    for (const locale of ["zh-CN", "en-US"]) {
      for (const theme of ["zai-light", "zai-dark"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on("pageerror", (error) => {
          errors.push(error.stack ?? error.message);
          process.stderr.write(String(error.stack ?? error.message) + "\n");
        });
        await page.goto(`${base}?locale=${locale}&theme=${theme}`);
        const tab = page.getByRole("tab", {
          name: locale === "zh-CN" ? "工作流" : "Workflows",
          exact: true,
        });
        await tab.waitFor({ timeout: 30000 });
        assert.equal(await page.evaluate(() => window.__lists), 0);
        await tab.click();
        await page.locator('[data-workflow-name="offline-review"]').waitFor();
        assert.ok((await page.evaluate(() => window.__lists)) > 0);
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.stack ?? error.message);
      process.stderr.write(String(error.stack ?? error.message) + "\n");
    });
    await page.goto(`${base}?disabled`);
    await page.getByRole("heading", { name: "自动化", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "工作流", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__lists), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS workflow management default-on and explicit-off at 1280/375px, both locales and themes.\n",
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
