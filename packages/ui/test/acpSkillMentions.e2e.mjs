// Isolated real editor fixture. No user configuration, sessions, or model requests are accessed.
// Run with the desktop Vite server on 5174: node packages/ui/test/acpSkillMentions.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-skills-e2e-${process.pid}`;
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
      import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
      import { TabStoreProvider } from "../../../ui/src/store/TabStoreProvider.tsx";
      import { PlatformProvider } from "../../../ui/src/hooks/usePlatform.tsx";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
      import "../../../ui/src/styles.css";
      window.__skillCalls = [];
      window.__nativeCalls = [];
      window.__sentValues = [];
      const skill = (name, enabled = true) => ({ id: "glm:workspace:" + name, name, enabled, description: "Test skill", body: "private body", path: "/test/.zcode/skills/" + name + "/SKILL.md", scope: "workspace" });
      const services = {
        clientConfigService: { getSnapshot: async () => ({ pluginStoreOrder: null }) },
        fileService: { searchWorkspaceFiles: async () => [] },
        pluginManagementService: { getPluginReferenceCatalog: async () => ({ authority: "workspace", plugins: [] }) },
        subagentsService: { list: async () => [] },
        zcodeSessionService: { list: async () => [] },
        skillsService: { list: async (input) => {
          window.__skillCalls.push(input);
          return { skills: [skill("Demo_Helper"), skill("Disabled", false)], diagnostics: [], capability: { userScopeAvailable: true } };
        } },
        zcodeAgentService: {
          getSkillReferenceCatalog: async (input) => {
            window.__nativeCalls.push(input);
            return { authority: "session", skills: [skill("Native_Helper")] };
          },
          onAgentRuntimeRestarted: () => ({ dispose() {} }),
          onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }),
          onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }),
        },
      };
      const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true, selectDirectory: async () => null };
      function Fixture() {
        const [acp, setAcp] = useState(true);
        return <><button data-testid="switch-mode" onClick={() => setAcp(!acp)}>Switch</button><div style={{ maxWidth: 700, margin: "120px auto 0" }}>
          <ChatPromptEditor workspacePath="/test" taskId="native-session" acpMode={acp} acpAgent={acp ? "codex" : null} acpSessionId={acp ? "acp-session" : null}
            enableMentionPanel enableSlashCommands={!acp} inputTestId="v4-composer-input" submitLabel="发送" onSubmit={(value) => { window.__sentValues.push(value); return false; }} />
        </div></>;
      }
      createRoot(document.getElementById("root")!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.goto(`http://localhost:5174/${name}.html`);
    const input = page.locator('[data-testid="v4-composer-input"]');
    await input.waitFor({ timeout: 10000 }).catch((cause) => {
      throw new Error(`Editor fixture failed: ${errors.join("; ") || cause.message}`);
    });
    await input.click();
    await page.keyboard.type("$Demo");
    const option = page
      .locator('[data-trigger="$"] [data-section-id="skills"]')
      .filter({ hasText: "Demo_Helper" });
    await option.waitFor();
    assert.equal(
      await page.evaluate(() => window.__nativeCalls.length),
      0,
      "ACP must read settings, not the native session catalog",
    );
    assert.ok(await page.evaluate(() => window.__skillCalls.length > 0));
    await option.click();
    await page.keyboard.type(" please run");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__sentValues.length === 1);
    assert.match(
      await page.evaluate(() => window.__sentValues[0]),
      /\[\$Demo_Helper\]\(\/test\/\.zcode\/skills\/Demo_Helper\/SKILL\.md\)/,
    );
    assert.ok(!(await page.evaluate(() => window.__sentValues[0])).includes("private body"));
    await input.fill("$Disabled");
    await page.locator('[data-trigger="$"]').waitFor();
    assert.equal(
      await page.locator('[data-trigger="$"] [role="option"]').count(),
      0,
      "Disabled skills must be unavailable",
    );
    await input.fill("@example");
    assert.equal(
      await page.locator('[data-trigger="@"]:visible').count(),
      0,
      "ACP must not enable native plugin/session mentions",
    );
    await page.locator('[data-testid="switch-mode"]').click();
    await input.fill("$Native");
    await page
      .locator('[data-trigger="$"] [data-section-id="skills"]')
      .filter({ hasText: "Native_Helper" })
      .waitFor();
    assert.ok(
      await page.evaluate(() =>
        window.__nativeCalls.some((input) => input.sessionId === "native-session"),
      ),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: ACP skill picker, disabled filtering, canonical submission and native catalog restoration at 1280px and 375px.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
