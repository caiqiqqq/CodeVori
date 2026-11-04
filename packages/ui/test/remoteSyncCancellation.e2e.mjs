import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__sync-cancellation-${process.pid}`;
const files = [join(renderer, `${name}.html`), join(renderer, `${name}.tsx`)];
const base = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193";
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    files[1],
    `import React from 'react';import{createRoot}from'react-dom/client';import{ZCodeFeatureFixture}from'../../../ui/test/fixtures/zcodeFeatures.tsx';createRoot(document.getElementById('root')!).render(<ZCodeFeatureFixture/>);`,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (mode) => {
    await page.goto(`${base}/${name}.html?mode=${mode}`);
    await page.waitForFunction(() => window.__feature);
  };
  const events = () => page.evaluate(() => window.__feature.events);

  for (const kind of ["mcp", "skill"]) {
    for (const step of ["preflight", "export"]) {
      await open("remote");
      const stage = `${kind}-${step}`;
      await page.evaluate((stage) => window.__feature.sync.gate(stage), stage);
      const label = kind === "mcp" ? "MCP 配置" : "技能";
      await page
        .getByTestId("settings-remote-sync")
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.getByRole("dialog").getByText("fixture-sync", { exact: true }).first().waitFor();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "同步已选项", exact: true })
        .click();
      await page.waitForFunction(
        (stage) =>
          window.__feature.events.some(([kind, step]) => kind === "sync-paused" && step === stage),
        stage,
      );
      await page.evaluate(() => {
        const { tabs, store } = window.__feature;
        store.getState().bindWorkspaceIdentity("ssh:fixture:/other", "remote-live");
        tabs.setState({
          tabs: tabs
            .getState()
            .tabs.map((tab) =>
              tab.id === "remote"
                ? { ...tab, workspaceIdentity: "ssh:fixture:/other", workspacePath: "/other" }
                : tab,
            ),
        });
      });
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.evaluate(() => window.__feature.sync.release());
      await page.waitForFunction(
        (stage) =>
          window.__feature.events.some(
            ([kind, step]) => kind === "sync-resolved" && step === stage,
          ),
        stage,
      );
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.equal(
        (await events()).some(([event]) => event === `${kind}-import`),
        false,
        `${stage} must not import after target changes`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS MCP/Skill preflight and export cancellation on target change");
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
