// Real ACP hook + real diagnostics, synthetic Host. No Agent or model request.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__diagnostics-${process.pid}`;
const html = join(root, `${name}.html`),
  moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(html, `<div id="root"></div><script type="module" src="./${name}.tsx"></script>`);
  await writeFile(
    moduleFile,
    `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {acpSessionSchema} from '@zcode/shared';
    import {useAcpConversation} from '../../../ui/src/v4/useAcpConversation.ts';
    import {startRendererPerformanceDiagnostics} from '../../../ui/src/lib/rendererPerformanceDiagnostics.ts';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {ScopedErrorBoundary} from '../../../ui/src/ErrorBoundary.tsx';
    window.__logs=[]; window.__throwSink=false;
    window.zcode={log:(_level,args)=>{if(window.__throwSink)throw new Error('sink unavailable');window.__logs.push(args)}};
    const monitor=startRendererPerformanceDiagnostics();
    const session=acpSessionSchema.parse({id:'synthetic',workspacePath:'/synthetic',agent:'codex',acpSessionId:'native',title:'fixture',revision:1,status:'idle',entries:[],pendingPermission:null,error:null});
    let release;
    const service={
      list:()=>new Promise(resolve=>{release=()=>resolve([session])}),
      onDynamicSessionChanged:()=>()=>({dispose(){}}),
      refresh:async()=>session,
      remove:async()=>{},
      create:async()=>session,
    };
    window.__release=()=>release?.(); window.__stop=()=>monitor.stop();
    function Crash({active}){if(active)throw new Error('Maximum update depth exceeded /private/path token=secret');return <span>healthy subtree</span>}
    function Fixture(){
      const view=useAcpConversation(service as never,{workspacePath:'/synthetic'},'codex');
      const [crash,setCrash]=React.useState(false);window.__crash=()=>setCrash(true);
      return <div data-testid='state' data-loaded={view.loaded} data-ready={view.ready} data-error={view.error??''}><input aria-label='draft'/><ScopedErrorBoundary scope='workspace-chat'><Crash active={crash}/></ScopedErrorBoundary></div>;
    }
    createRoot(document.getElementById('root')!).render(<ZCodeIntlProvider initialLocale='zh-CN'><Fixture/></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.clock.install();
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    await page.locator('[data-testid="state"]').waitFor();
    await page.getByRole("textbox", { name: "draft" }).fill("draft retained");
    await page.clock.runFor(6000);
    await page.waitForFunction(() =>
      window.__logs.some(
        (args) =>
          args[0] === "[diagnostics]" &&
          args[1].operation === "acp.list" &&
          args[1].status === "pending",
      ),
    );
    await page.evaluate(() => {
      window.__throwSink = true;
      window.__release();
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="state"]').dataset.ready === "true",
    );
    assert.equal(await page.getByRole("textbox", { name: "draft" }).inputValue(), "draft retained");
    const summary = await page.evaluate(() => {
      window.__throwSink = false;
      const event = new ErrorEvent("error", {
        error: new Error("Maximum update depth exceeded /private/path token=secret"),
        cancelable: true,
      });
      const untouched = window.dispatchEvent(event);
      window.__stop();
      return { untouched, logs: window.__logs };
    });
    assert.equal(summary.untouched, true, "diagnostics do not suppress existing error handling");
    assert.ok(summary.logs.some((args) => args[1]?.error?.cause === "maximum-update-depth"));
    assert.equal(JSON.stringify(summary.logs).includes("secret"), false);
    assert.equal(JSON.stringify(summary.logs).includes("/private/path"), false);
    await page.evaluate(() => window.__crash());
    await page.waitForFunction(() =>
      window.__logs.some((args) => args[1]?.operation === "renderer.react-scoped"),
    );
    assert.equal(await page.getByRole("textbox", { name: "draft" }).inputValue(), "draft retained");
    const diagnosticLines = await page.evaluate(() =>
      window.__logs.filter((args) => args[0] === "[diagnostics]"),
    );
    assert.equal(JSON.stringify(diagnosticLines).includes("secret"), false);
    await page.close();
  }
  console.log(
    "diagnostics E2E passed at 1280/375px: pending load, throwing sink, retained draft, global and React boundary errors",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
