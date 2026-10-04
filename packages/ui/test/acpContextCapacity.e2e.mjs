// Run with the desktop Vite server on 5174: node packages/ui/test/acpContextCapacity.e2e.mjs
// Real shared editor/model toolbar with fake Host snapshots; no real Agent prompt or user data.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-context-e2e-${process.pid}`;
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
      import { ChatPromptEditor } from "../../../ui/src/prompt-editor/ChatPromptEditor.tsx";
      import { V4ComposerModelControls } from "../../../ui/src/v4/composer/V4ComposerToolbar.tsx";
      import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
      import { TabStoreProvider } from "../../../ui/src/store/TabStoreProvider.tsx";
      import { PlatformProvider } from "../../../ui/src/hooks/usePlatform.tsx";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
      import "../../../ui/src/styles.css";
      const services = {
        settingService: { get: async () => ({}) },
        clientConfigService: { getSnapshot: async () => ({ pluginStoreOrder: null }) },
        fileService: { searchWorkspaceFiles: async () => [] },
        acpService: { listPlugins: async () => [], listAvailableAgents: async () => [
          { agent: 'codex', enabled: true, ready: true },
          { agent: 'claude', enabled: true, ready: true },
        ] },
        subagentsService: { list: async () => [] },
        zcodeSessionService: { list: async () => [] },
        skillsService: { list: async () => ({ skills: [], diagnostics: [], capability: { userScopeAvailable: true } }) },
        zcodeAgentService: { onAgentRuntimeRestarted: () => ({ dispose() {} }), onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }), onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }) },
      };
      const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true };
      function Fixture() {
        const [view, setView] = useState<any>({ agent: null, context: null, native: {
          contextWindow: { usedTokens: 2000, maxTokens: 8000, cache: { hitRate: 0.25 } },
        } });
        const [picker, setPicker] = useState(null);
        window.__setContextView = setView;
        return <main style={{ width: 'min(700px, calc(100vw - 32px))', margin: '300px auto 0' }}>
          <ChatPromptEditor workspacePath="/fixture" taskId={null} inputTestId="v4-composer-input"
            initialValue="保留草稿" submitLabel="发送" onSubmit={() => false}
            acpMode={Boolean(view.agent)} acpAgent={view.agent} enableMentionPanel={false} enableSlashCommands={false}
            submitControl={<div className="flex items-center gap-1" data-testid="composer-context-fixture">
              <V4ComposerModelControls workspacePath="/fixture" sessionId={null} phase={null}
                usage={view.native} disabled={false} acpAgent={view.agent} acpContextUsage={view.context}
                activeConfigPicker={picker} onConfigPickerOpenChange={(kind, open) => setPicker(open ? kind : null)}
                onSelectAcpAgent={agent => setView(current => ({ ...current, agent, context: null }))}
                onSelectModel={() => {}} onSelectThought={() => {}} onSwitchMode={() => {}} />
            </div>} />
        </main>;
      }
      createRoot(document.getElementById("root")!).render(
        <PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}>
          <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider>
        </ServiceProvider></TabStoreProvider></PlatformProvider>
      );
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      hasTouch: width === 375,
      isMobile: width === 375,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://localhost:5174/${name}.html`);
    const trigger = page.locator('[data-testid="chat-context-usage-trigger"]');
    await trigger.waitFor({ timeout: 10000 }).catch((error) => {
      throw new Error(`Context fixture failed: ${errors.join("; ") || error.message}`);
    });
    assert.match(await trigger.getAttribute("aria-label"), /2,000.*8,000/);
    const input = page.getByTestId("v4-composer-input");
    await input.waitFor();
    await page.evaluate(() => {
      window.__originalComposerInput = document.querySelector('[data-testid="v4-composer-input"]');
    });

    await page.evaluate(() => window.__setContextView((view) => ({ ...view, agent: "codex" })));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="chat-context-usage-trigger"]')
          ?.getAttribute("aria-label") === "智能体尚未返回上下文用量",
    );
    assert.equal(
      await trigger.locator("circle").count(),
      1,
      "unknown must not show a zero-percent arc",
    );
    if (width === 375) await trigger.tap();
    else await trigger.hover();
    await page.getByText("智能体尚未返回上下文用量", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("progressbar").count(),
      0,
      "unknown is not a numerical estimate",
    );
    await page.mouse.move(0, 0);
    if (width === 375) await input.tap();
    else await input.click();
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        context: { used: 9000, size: 200000 },
      })),
    );
    await trigger.waitFor();
    assert.match(await trigger.getAttribute("aria-label"), /9,000.*200,000/);
    if (width === 375) await trigger.tap();
    else await trigger.hover();
    await page.getByText("上下文容量").waitFor();
    assert.equal(await page.getByText("平均缓存命中率").count(), 0);

    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: "claude",
        context: null,
      })),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="chat-context-usage-trigger"]')
          ?.getAttribute("aria-label") === "智能体尚未返回上下文用量",
    );
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        context: { used: 3500, size: 10000 },
      })),
    );
    await trigger.waitFor();
    assert.match(await trigger.getAttribute("aria-label"), /3,500.*10,000/);
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: "codex",
        context: { used: 9000, size: 200000 },
      })),
    );
    assert.match(await trigger.getAttribute("aria-label"), /9,000.*200,000/);
    for (const context of [{ used: 0, size: 200000 }, { used: 9000, size: 0 }, null]) {
      await page.evaluate(
        (context) => window.__setContextView((view) => ({ ...view, context })),
        context,
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="chat-context-usage-trigger"]')
            ?.getAttribute("aria-label") === "智能体尚未返回上下文用量",
      );
    }
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: null,
        context: null,
      })),
    );
    assert.match(await trigger.getAttribute("aria-label"), /2,000.*8,000/);
    assert.equal(await input.textContent(), "保留草稿");
    assert.equal(
      await page.evaluate(
        () =>
          window.__originalComposerInput ===
          document.querySelector('[data-testid="v4-composer-input"]'),
      ),
      true,
      "target changes must retain the original editor DOM",
    );
    assert.equal(await page.getByTestId("v4-composer-input").count(), 1);
    await page.evaluate(() => window.__setContextView((view) => ({ ...view, native: null })));
    await trigger.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: real shared editor/toolbar, API/ACP capacity, unknown ring, hover/touch, target isolation at 1280/375px.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
