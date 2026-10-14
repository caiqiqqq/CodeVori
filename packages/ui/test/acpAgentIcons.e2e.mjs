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
      const state = {catalog:ACP_AGENT_CATALOG, calls:[], release:null, released:false, newer:true};
      window.__iconFixture = state;
      const infos = (checked) => ACP_AGENT_CATALOG.map(({id}, index) => ({
        agent:id, command:'fake', args:[], distribution:'npm', platformSupported:true,
        registryVersion:'2.0.0', installedVersion:index===0?'1.0.0':index===1?'2.0.0':index===2?'3.0.0':index===3?'unknown':'1.0.0',
        updateCheck:{status:checked && index!==4?'checked':index===4?'error':'unchecked', source:'acp-registry', checkedAt:null},
        enabled:index!==5, env:{}, source:'system', ready:true, managedVersion:null,
        executablePath:'/fake/agent', nativeCommand:'', nativePath:null, nodeVersion:'24.14.0', npmVersion:'10.33.2'
      }));
      const service = new Proxy({
        readCodexConfig() { return Promise.resolve({version:'fixture',authMode:'custom',managedProvider:true,hasSubscriptionCredentials:false,apiUrl:'https://api.example.test/v1',apiKey:'example-not-a-secret',model:'gpt-example'}); },
        listCodexModels() { return Promise.resolve([{slug:'gpt-example',name:'Example model'}]); },
        listAgents(options) {
          state.calls.push(options?.checkUpdates ? 'checkUpdates' : 'listAgents');
          if(state.released) return Promise.resolve(infos(Boolean(options?.checkUpdates && state.newer)));
          return new Promise(resolve => {state.release=()=>{state.released=true;resolve(infos(false))}});
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
      assert.equal(await section.locator("[data-acp-agent-update]").count(), 0);
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
      const update = (id) =>
        page.getByTestId(`settings-acp-agent-${id}`).locator("[data-acp-agent-update]");
      await update(catalog[0].id).waitFor();
      assert.equal(await section.getByTestId("acp-agent-environment").count(), 1);
      assert.equal(
        await section.getByRole("switch", { name: "由 Agent 自行处理文件与命令" }).count(),
        0,
      );
      assert.equal(await section.locator('[data-testid^="settings-acp-check-"]').count(), 2);
      for (const id of ["node", "npm", "native"]) {
        assert.equal(await section.getByTestId(`settings-acp-check-${id}`).count(), 0);
      }
      assert.equal(await update(catalog[0].id).count(), 1, "Older checked version has an update");
      assert.equal(
        await update(catalog[5].id).count(),
        1,
        "Disabled installed agent can have an update",
      );
      for (const index of [1, 2, 3, 4]) {
        assert.equal(
          await update(catalog[index].id).count(),
          0,
          `Agent ${index} has no confirmed update`,
        );
      }
      assert.match(
        await page.getByTestId(`settings-acp-agent-${catalog[0].id}`).getAttribute("aria-label"),
        /2\.0\.0/,
      );
      await section.screenshot({ path: `/tmp/zcode-agent-updates-${width}-${theme}.png` });
      await page.evaluate(() => {
        window.__iconFixture.newer = false;
      });
      await page.getByTestId("settings-acp-agents-refresh").click();
      await update(catalog[0].id).waitFor({ state: "detached" });
      assert.equal(
        await update(catalog[5].id).count(),
        0,
        "Refresh removes stale update indicators",
      );
      await page.getByTestId(`settings-acp-agent-${catalog[0].id}`).focus();
      await page.keyboard.press("Space");
      await page.getByTestId(`settings-acp-agent-detail-${catalog[0].id}`).waitFor();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
        `settings-acp-agent-${catalog[1].id}`,
        "Tab advances to the next agent",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page.getByTestId(`settings-acp-agent-${catalog[1].id}`).getAttribute("aria-pressed"),
        "true",
        `Keyboard selection failed: ${errors.join("; ")}`,
      );
      await page.getByTestId(`settings-acp-agent-detail-${catalog[1].id}`).waitFor();
      assert.equal(await section.getByTestId("acp-agent-environment").count(), 0);
      assert.equal(await section.getByTestId("acp-codex-native-config").count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__iconFixture.calls), [
        "listAgents",
        "checkUpdates",
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
