import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__memory-settings-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-memory-settings-"));
let server, browser, page;
const errors = [];
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
    import {MemorySettingsSection} from '../../../ui/src/settings/MemorySettingsSection.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import '../../../ui/src/styles.css';
    let files:any[]=[];
    (window as any).catalogReads=0;
    let notify=()=>{};
    const memoryService:any={
      onDynamicProjectMemoriesChanged:()=>listener=>{notify=listener; return {dispose(){notify=()=>{}}}},
      resolveProjectMemoryWorkspaceId:async()=> 'iot-forway-113ceb1f7cc55ff8',
      listProjectMemories:async()=>{(window as any).catalogReads++;return [
      {id:'zcode-1111111111111111',label:'zcode',displayPath:'/workspace/main/zcode',updatedAt:2,files:[]},
      {id:'zcode-2222222222222222',label:'zcode',updatedAt:1,files:[]},
      {id:'iot-forway-113ceb1f7cc55ff8',label:'iot-forway',updatedAt:0,files}
    ]}};
    (window as any).saveFixtureMemory=()=>{
      files=[{name:'delegation-agent-routing.md',path:'/fixtures/delegation-agent-routing.md',kind:'item',size:100,updatedAt:Date.now()}];
      notify();
    };
    createRoot(document.getElementById('root')!).render(
      <PlatformProvider platform={{getInstalledEditors:async()=>[]} as any}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
        <MemorySettingsSection memoryEnabled={true} memoryService={memoryService}
          onMemoryEnabledChange={async()=>{}} projectMemoryViewerAvailable={true} workspacePath="/workspace/iot-forway"/>
      </TooltipProvider></ZCodeIntlProvider></PlatformProvider>
    );
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 320, height: 720 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const trigger = page.locator('[data-plugin-scope-trigger="true"]');
  await trigger.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-plugin-scope-trigger="true"]')
        ?.getAttribute("data-plugin-scope-key") === "iot-forway-113ceb1f7cc55ff8",
  );
  await page.evaluate(() => window.saveFixtureMemory());
  await page.getByText("delegation-agent-routing.md", { exact: true }).waitFor();
  await trigger.click();
  const options = page.getByRole("menuitemradio");
  assert.equal(await options.count(), 3);
  await page.getByText("/workspace/main/zcode", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
    return menu && getComputedStyle(menu).opacity === "1";
  });
  await page.screenshot({ path: join(artifacts, "mobile.png") });
  await options.nth(1).click();
  assert.equal((await trigger.textContent())?.trim(), "zcode");
  assert.equal(await trigger.getAttribute("data-plugin-scope-key"), "zcode-2222222222222222");
  const beforeRefresh = await page.evaluate(() => window.catalogReads);
  await page.evaluate(() => window.saveFixtureMemory());
  await page.waitForFunction((previous) => window.catalogReads > previous, beforeRefresh);
  assert.equal(await trigger.getAttribute("data-plugin-scope-key"), "zcode-2222222222222222");
  await options.first().waitFor({ state: "hidden" });
  await trigger.click();
  await options.nth(2).click();
  assert.equal((await trigger.textContent())?.trim(), "iot-forway");
  assert.equal(await trigger.getAttribute("data-plugin-scope-key"), "iot-forway-113ceb1f7cc55ff8");
  await options.first().waitFor({ state: "hidden" });
  await trigger.click();
  await options.nth(0).click();
  assert.equal(await trigger.getAttribute("title"), "/workspace/main/zcode");
  await options.first().waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await trigger.click();
  await page.getByText("/workspace/main/zcode", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
    return menu && getComputedStyle(menu).opacity === "1";
  });
  await page.screenshot({ path: join(artifacts, "desktop.png") });
  const menu = page.getByRole("menu");
  const bounds = await menu.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1280);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: memory scope labels and paths are selectable at 320px and 1280px. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
