// Run with the desktop Vite server on 5174: node packages/ui/test/acpComposerControlsPreview.e2e.mjs
// Isolated real toolbar: delayed ACP snapshots, no Agent launch, config write or model request.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-controls-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
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
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { AcpComposerConfigControls } from "../../../ui/src/v4/composer/AcpComposerConfigControls.tsx";
      import { useAcpComposerConfigPreview } from "../../../ui/src/v4/composer/useAcpComposerConfigPreview.ts";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
      import "../../../ui/src/styles.css";
      window.__configWrites = [];
      function Fixture() {
        const [view, setView] = useState({ workspacePath: "/one", agent: "codex", ready: false, session: null, error: null });
        window.__setAcpView = (patch) => setView(current => ({ ...current, ...patch }));
        const preview = useAcpComposerConfigPreview({ ...view, workspaceIdentity: "remote-one" });
        return view.agent ? <AcpComposerConfigControls
          agent={view.agent} sessionId={view.session?.id} options={preview.options} modes={preview.modes}
          loading={preview.loading} disabled={!view.ready}
          onChange={async (id, value) => { window.__configWrites.push([id, value]); }}
        /> : null;
      }
      createRoot(document.getElementById("root")!).render(
        <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider>
      );
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://localhost:5174/${name}.html`);
    const loading = page.locator('[data-testid="acp-config-loading"]');
    await loading.waitFor({ timeout: 10000 }).catch((error) => {
      throw new Error(`Toolbar fixture failed: ${errors.join("; ") || error.message}`);
    });
    const trigger = page.locator('[data-testid="acp-config-trigger-mode"]');
    assert.equal(await trigger.count(), 0, "Do not invent options before the Agent responds");
    const codex = {
      id: "codex-session",
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "agent",
          options: [
            { value: "agent", name: "Agent" },
            { value: "read-only", name: "Read only" },
          ],
        },
      ],
      modeState: null,
    };
    await page.evaluate((session) => window.__setAcpView({ session, ready: true }), codex);
    await trigger.waitFor();
    assert.equal(await trigger.isEnabled(), true);
    assert.match(await trigger.getAttribute("aria-label"), /自动审核/);
    await page.evaluate(() =>
      window.__setAcpView({ agent: "claude", ready: false, session: null }),
    );
    await loading.waitFor();
    assert.equal(await trigger.count(), 0, "Codex controls cannot leak into Claude");
    const claude = {
      id: "claude-session",
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Manual" }],
        },
      ],
      modeState: null,
    };
    await page.evaluate((session) => window.__setAcpView({ session, ready: true }), claude);
    await trigger.waitFor();
    assert.match(await trigger.getAttribute("aria-label"), /手动确认/);
    await page.evaluate(() => window.__setAcpView({ agent: "codex", ready: false, session: null }));
    await page.waitForFunction(
      () => document.querySelector('[data-testid="acp-config-trigger-mode"]')?.disabled === true,
    );
    assert.match(await trigger.getAttribute("aria-label"), /自动审核/);
    assert.equal(await loading.count(), 0, "Previously observed controls appear while connecting");
    await trigger.click({ force: true });
    assert.deepEqual(
      await page.evaluate(() => window.__configWrites),
      [],
      "Preview cannot change config",
    );
    await page.evaluate((session) => window.__setAcpView({ ready: true, session }), {
      ...codex,
      configOptions: [{ ...codex.configOptions[0], currentValue: "read-only" }],
    });
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="acp-config-trigger-mode"]')
        ?.getAttribute("aria-label")
        ?.includes("操作前确认"),
    );
    assert.equal(await trigger.isEnabled(), true);
    await page.evaluate(() =>
      window.__setAcpView({ workspacePath: "/two", ready: false, session: null }),
    );
    await loading.waitFor();
    assert.equal(await trigger.count(), 0, "Another workspace has no borrowed preview");
    await page.evaluate(() => window.__setAcpView({ error: "authentication failed" }));
    await loading.waitFor({ state: "hidden" });
    assert.equal(await trigger.count(), 0);
    await page.evaluate(() => window.__setAcpView({ agent: null }));
    assert.equal(await page.locator('[data-testid="acp-composer-config-controls"]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: immediate pending toolbar, isolated display preview, disabled writes, current Host values and 1280/375 layouts.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
