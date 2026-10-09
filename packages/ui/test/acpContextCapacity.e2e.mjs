// Run with the desktop Vite server on 5174: node packages/ui/test/acpContextCapacity.e2e.mjs
// Real shared editor/model toolbar with fake Host snapshots; no real Agent prompt or user data.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { exerciseComposerAgentIcons } from "./composerAgentIconsAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-context-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "codevori-composer-agent-icons-"));
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
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ACP_AGENT_CATALOG } from "@zcode/shared";
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
        acpService: { listPlugins: async () => [], listAvailableAgents: async () => ACP_AGENT_CATALOG.map(({id}) => ({agent:id,enabled:true,ready:true})) },
        subagentsService: { list: async () => [] },
        zcodeSessionService: { list: async () => [] },
        skillsService: { list: async () => ({ skills: [], diagnostics: [], capability: { userScopeAvailable: true } }) },
        zcodeAgentService: { onAgentRuntimeRestarted: () => ({ dispose() {} }), onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }), onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }) },
      };
      const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true };
      window.__composerAgents = ACP_AGENT_CATALOG.map(({id,name}) => ({id,name}));
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
                usage={view.native} disabled={false} acpAgent={view.agent} acpContextUsage={view.context} acpTokenUsage={view.tokens}
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
    const assertCapacityLabel = async (expected) => {
      // setState 返回不代表 React 已提交；等待实际展示值，不能仅等待一直存在的触发器。
      await page.waitForFunction(
        (pattern) =>
          new RegExp(pattern).test(
            document
              .querySelector('[data-testid="chat-context-usage-trigger"]')
              ?.getAttribute("aria-label") ?? "",
          ),
        expected.source,
      );
      assert.match(await trigger.getAttribute("aria-label"), expected);
    };
    await assertCapacityLabel(/2,000.*8,000/);
    const input = page.getByTestId("v4-composer-input");
    await input.waitFor();
    await exerciseComposerAgentIcons(page, input, artifacts, width);
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
    // 手机宽度下容量浮层覆盖输入框中心，触摸页面空白处关闭，而不是点进浮层正文。
    if (width === 375) await page.touchscreen.tap(4, 4);
    else await input.click();
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        context: { used: 9000, size: 200000 },
      })),
    );
    await trigger.waitFor();
    await assertCapacityLabel(/9,000.*200,000/);
    if (width === 375) await trigger.tap();
    else await trigger.hover();
    await page
      .getByText("上下文容量")
      .waitFor()
      .catch(async (error) => {
        await page.screenshot({ path: join(artifacts, `capacity-failure-${width}.png`) });
        throw new Error(
          `${error.message}; width=${width}; errors=${errors.join("; ")}; artifacts=${artifacts}; body=${(await page.locator("body").innerText()).slice(-1200)}`,
        );
      });
    await page.getByText("9K/200K (4.5%)", { exact: true }).waitFor();
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
    await assertCapacityLabel(/3,500.*10,000/);
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: "codex",
        context: { used: 9000, size: 200000 },
      })),
    );
    await assertCapacityLabel(/9,000.*200,000/);
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
    // 已知消耗与未知容量独立；真实零命中率和缺失写入必须准确显示。
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: "codex",
        context: null,
        tokens: {
          source: "native",
          usage: { totalTokens: 120, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 },
        },
      })),
    );
    if (width === 375) await trigger.tap();
    else await trigger.hover();
    await page.getByTestId("context-token-usage").waitFor();
    assert.equal(await page.getByTestId("context-token-input").locator("dd").textContent(), "100");
    assert.equal(await page.getByTestId("context-token-output").locator("dd").textContent(), "20");
    assert.equal(await page.getByTestId("context-token-total").locator("dd").textContent(), "120");
    assert.equal(await page.getByTestId("context-token-hitRate").locator("dd").textContent(), "0%");
    assert.equal(
      await page.getByTestId("context-token-cacheWrite").locator("dd").textContent(),
      "—",
    );
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        tokens: {
          source: "turns",
          measuredTurns: 2,
          usage: {
            totalTokens: 240,
            inputTokens: 200,
            outputTokens: 40,
            cacheReadTokens: 100,
            cacheWriteTokens: 20,
          },
        },
      })),
    );
    await page.getByText("已统计轮次：2", { exact: true }).waitFor();
    assert.equal(
      await page.getByTestId("context-token-cacheWrite").locator("dd").textContent(),
      "20",
    );
    assert.equal(
      await page.getByTestId("context-token-hitRate").locator("dd").textContent(),
      "50%",
    );
    // 截图中的百万级统计采用 Codeg K/M；原始计数和命中率不受显示舍入影响。
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        context: { used: 181000, size: 260000 },
        tokens: {
          source: "native",
          usage: {
            inputTokens: 70997350,
            outputTokens: 326330,
            cacheReadTokens: 67434971,
            totalTokens: 71323680,
          },
        },
      })),
    );
    await assertCapacityLabel(/181,000.*260,000/);
    // 快照更新会移动 hover 浮层；先按真实触摸/键盘入口重新打开，再读取统计。
    if (width === 375) await trigger.tap();
    else await trigger.focus();
    await page.getByText("181K/260K (69.6%)", { exact: true }).waitFor();
    for (const [key, text, exact] of [
      ["input", "71M", "70,997,350"],
      ["output", "326.3K", "326,330"],
      ["cacheRead", "67.4M", "67,434,971"],
      ["total", "71.3M", "71,323,680"],
    ]) {
      const count = page.getByTestId(`context-token-${key}`).locator("dd");
      assert.equal(await count.textContent(), text);
      assert.equal(await count.getAttribute("title"), exact);
    }
    assert.equal(
      await page.getByTestId("context-token-hitRate").locator("dd").textContent(),
      "95%",
    );
    assert.equal(
      await page.getByTestId("context-token-cacheWrite").locator("dd").textContent(),
      "—",
    );
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.classList.remove("theme-zai-light", "theme-zai-dark", "dark");
        document.documentElement.classList.add(
          `theme-${theme}`,
          ...(theme === "zai-dark" ? ["dark"] : []),
        );
      }, theme);
      if (width === 375) await trigger.tap();
      else {
        await page.mouse.move(0, 0);
        await trigger.hover();
      }
      await page.getByTestId("context-token-usage").waitFor();
      await page.getByTestId("context-token-usage").evaluate(async (element) => {
        const panel = element.closest('[data-slot="hover-card-content"]');
        await Promise.all(
          panel.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: join(artifacts, `token-units-${width}-${theme}.png`) });
    }
    await page.mouse.move(0, 0);
    if (width === 375) await page.touchscreen.tap(4, 4);
    else await input.click();
    await page.evaluate(() =>
      window.__setContextView((view) => ({
        ...view,
        agent: null,
        context: null,
      })),
    );
    await assertCapacityLabel(/2,000.*8,000/);
    assert.equal(await page.getByTestId("context-token-usage").count(), 0);
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
    `PASS: real shared editor/toolbar, 15 Agent menu icons, selected Agent icons in both themes, API return, retained draft, API/ACP capacity, unknown ring, hover/touch, target isolation at 1280/375px. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
