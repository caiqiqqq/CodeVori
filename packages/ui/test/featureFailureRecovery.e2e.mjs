import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__feature-failure-${process.pid}`;
const files = [join(renderer, `${name}.html`), join(renderer, `${name}.tsx`)];
const base = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193";
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
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

  await open("remote");
  await page.evaluate(() => {
    window.__feature.failures.stop = "fixture stop denied";
  });
  const devices = page.getByTestId("remote-workspace-services");
  await devices.getByRole("button").click();
  await page.getByRole("menuitem", { name: /重启/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await devices.getByRole("alert").getByText("fixture stop denied").waitFor({ timeout: 3000 });
  assert.equal(
    await page.evaluate(() => window.__feature.events.some(([kind]) => kind === "reconnect")),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      Boolean(window.__feature.store.getState().sessionsById["remote-live"]),
    ),
    true,
  );

  await page.evaluate(() => window.__feature.store.getState().unregisterSession("remote-live"));
  await devices.getByText("已停止 / 未连接", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.__feature.tabs.getState().tabs.find((tab) => tab.id === "remote").remoteSessionId,
    ),
    "remote-live",
  );
  await devices.getByRole("button").click();
  assert.equal(
    await page.getByRole("menuitem", { name: /停止/ }).getAttribute("aria-disabled"),
    "true",
  );
  await page.keyboard.press("Escape");

  await open("projects");
  await page.evaluate(() => {
    window.__feature.failures.settings = "fixture settings failure";
  });
  const projects = page.getByTestId("settings-projects");
  await projects.getByRole("checkbox", { name: "local", exact: true }).check();
  const remove = projects.getByRole("button", { name: /移除.*1|删除.*1/ });
  await remove.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await projects
    .getByRole("status")
    .getByText(/fixture settings failure/)
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__feature.settings.recentProjects.includes("/project-a")),
    true,
  );
  assert.equal(
    await page.evaluate(() =>
      window.__feature.tabs.getState().tabs.some((tab) => tab.id === "local"),
    ),
    true,
    "failed project removal must retain its open tab",
  );

  await page.evaluate(() => {
    window.__feature.failures.settings = "";
  });
  await projects.getByRole("checkbox", { name: "local", exact: true }).check();
  await remove.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await page.waitForFunction(
    () => !window.__feature.settings.recentProjects.includes("/project-a"),
  );
  assert.equal(
    await page.evaluate(() =>
      window.__feature.tabs.getState().tabs.some((tab) => tab.id === "local"),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log("PASS remote stop errors/stale session and project removal failure/retry");
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
