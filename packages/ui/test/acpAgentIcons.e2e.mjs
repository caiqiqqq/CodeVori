// Real settings navigation with a fake Host; no credentials, installations or model calls.
// Run against desktop Vite: node packages/ui/test/acpAgentIcons.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-icons-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ACP_AGENT_CATALOG} from '@zcode/shared';
      import {AcpAgentsSection} from '../../../ui/src/settings/AcpAgentsSection.tsx';
      import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
      import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
      import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
      import '../../../ui/src/styles.css';
      const state = {catalog:ACP_AGENT_CATALOG, calls:[], release:null, released:false};
      window.__iconFixture = state;
      const service = new Proxy({
        listAgents(options) {
          state.calls.push(options?.checkUpdates ? 'checkUpdates' : 'listAgents');
          if(state.released) return Promise.resolve([]);
          return new Promise(resolve => {state.release=()=>{state.released=true;resolve([])}});
        }
      }, {get(target,key) {
        if(key in target) return target[key];
        return ()=>{throw new Error('Unexpected Host operation: '+String(key))};
      }});
      createRoot(document.getElementById('root')).render(
        <PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false}}>
          <TabStoreProvider><ServiceProvider services={{acpService:service}}>
            <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
              <main style={{maxWidth:960,margin:'16px auto',padding:'0 12px'}}>
                <AcpAgentsSection workspacePath={null}/>
              </main>
            </TooltipProvider></ZCodeIntlProvider>
          </ServiceProvider></TabStoreProvider>
        </PlatformProvider>);
      `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      const externalRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          externalRequests.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
        document.body.className = "bg-background text-foreground";
      }, theme);
      const section = page.getByTestId("settings-acp-agents");
      await section.waitFor();
      const catalog = await page.evaluate(() => window.__iconFixture.catalog);
      assert.equal(catalog.length, 15);
      const buttons = section.locator('[data-testid^="settings-acp-agent-"][aria-pressed]');
      assert.equal(await buttons.count(), catalog.length);
      assert.equal(
        await buttons.locator("[data-acp-agent-icon]").count(),
        catalog.length,
        "All agents need their icons before Host diagnostics finish",
      );
      await page.waitForFunction(() => typeof window.__iconFixture.release === "function");

      const iconSource = async (icon) =>
        icon.evaluate((element) => {
          const image = element.querySelector("img");
          if (image) return image.src;
          const mask = element.querySelector("[data-acp-icon-mask]");
          return mask ? getComputedStyle(mask).maskImage.match(/^url\("?(.*?)"?\)$/)?.[1] : null;
        });
      const sources = new Set();
      for (const { id, name: label } of catalog) {
        const button = page.getByTestId(`settings-acp-agent-${id}`);
        const listIcon = button.locator("[data-acp-agent-icon]");
        assert.equal(await button.getAttribute("aria-label"), label);
        assert.equal(await listIcon.getAttribute("data-acp-agent-icon"), id);
        assert.equal(await listIcon.getAttribute("aria-hidden"), "true");
        assert.deepEqual(
          await listIcon.evaluate((element) => {
            const { width, height } = element.getBoundingClientRect();
            return [width, height];
          }),
          [16, 16],
        );
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        const detail = page.getByTestId(`settings-acp-agent-detail-${id}`);
        await detail.waitFor();
        assert.equal(await detail.locator("h3").textContent(), label);
        const titleIcon = detail.locator("[data-acp-agent-icon]");
        assert.equal(await titleIcon.getAttribute("data-acp-agent-icon"), id);
        assert.deepEqual(
          await titleIcon.evaluate((element) => {
            const { width, height } = element.getBoundingClientRect();
            return [width, height];
          }),
          [20, 20],
        );
        const src = await iconSource(listIcon);
        assert.ok(src, `Missing brand asset for ${id}`);
        assert.equal(await iconSource(titleIcon), src);
        assert.ok(src.startsWith("data:") || new URL(src).origin === origin);
        assert.equal(
          await page.evaluate(
            (src) =>
              new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
                image.onerror = () => resolve(false);
                image.src = src;
              }),
            src,
          ),
          true,
          `Brand asset must decode: ${id}`,
        );
        const mask = listIcon.locator("[data-acp-icon-mask]");
        if (await mask.count()) {
          assert.equal(
            await mask.evaluate((element) => getComputedStyle(element).backgroundColor),
            await button.evaluate((element) => getComputedStyle(element).color),
            `Monochrome ${id} follows the theme foreground`,
          );
        }
        sources.add(src);
      }
      assert.equal(sources.size, catalog.length, "Every agent has a distinct brand mark");

      await page.evaluate(() => window.__iconFixture.release());
      await page.waitForFunction(() => window.__iconFixture.calls.length === 2);
      await page.getByTestId(`settings-acp-agent-${catalog[0].id}`).focus();
      await page.keyboard.press("Space");
      await page.getByTestId(`settings-acp-agent-detail-${catalog[0].id}`).waitFor();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.getByTestId(`settings-acp-agent-detail-${catalog[1].id}`).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__iconFixture.calls), [
        "listAgents",
        "checkUpdates",
      ]);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        "Settings navigation must not overflow on narrow screens",
      );
      assert.deepEqual(externalRequests, [], "Icons must not make remote image requests");
      assert.deepEqual(errors, []);
      await page.mouse.move(width - 2, 2);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'));
      await section.screenshot({ path: `/tmp/zcode-agent-icons-${width}-${theme}.png` });
      await page.close();
    }
  }
  process.stdout.write(
    "PASS: all 15 settings icons, matching headers, local assets, light/dark, keyboard and narrow layouts.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
