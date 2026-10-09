// Synthetic workspaces only; exercise the real shared scope menu without a Host connection.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__plugin-scope-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts =
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? (await mkdtemp(join(tmpdir(), "zcode-plugin-scope-")));
const tab = (path, extra = {}) => ({
  id: path,
  kind: "workspace",
  workspacePath: path,
  label: path.split("/").at(-1),
  ...extra,
});
const tabs = [
  tab("/projects/zcode"),
  tab("/projects/zcode", { id: "duplicate" }),
  tab("/worktrees/another-parent/zcode"),
  tab("/projects/topology"),
  tab("/projects/iot-forway"),
  tab("/worktrees/iot-forway"),
  tab("/projects/default"),
  tab("/projects/zcode", { workspaceIdentity: "ssh:a:/projects/zcode" }),
  tab("/projects/zcode", {
    workspaceIdentity: "ssh:a:/projects/zcode",
    remoteSessionId: "session-a",
    remoteTarget: { kind: "ssh", host: "a.example.invalid", username: "tester" },
  }),
  tab("/projects/zcode", {
    workspaceIdentity: "ssh:b:/projects/zcode",
    remoteSessionId: "session-b",
    remoteTarget: { kind: "ssh", host: "b.example.invalid", username: "tester" },
  }),
  tab("/missing/zcode", { availability: "unavailable-local-directory" }),
];
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {PluginScopeMenu} from "../../../ui/src/settings/PluginScopeMenu.tsx";
    import {ZCodeIntlProvider} from "../../../ui/src/i18n/IntlProvider.tsx";
    import "../../../ui/src/styles.css";
    const tabs = ${JSON.stringify(tabs)};
    const explicit = [
      {key:'a',label:'iot-forway',description:'/projects/iot-forway'},
      {key:'a',label:'iot-forway',description:'/ignored'},
      {key:'b',label:'iot-forway',description:'/worktrees/iot-forway'},
    ];
    const state = {calls:[],setExplicit:null};
    window.__scope = state;
    function Fixture(){
      const [selected,setSelected] = useState('user');
      const [useExplicit,setExplicit] = useState(false);
      state.setExplicit = setExplicit;
      return <main className="min-h-screen bg-background p-4 text-foreground">
        <PluginScopeMenu selectedScopeKey={selected} workspaceTabs={tabs}
          workspaceOptions={useExplicit ? explicit : undefined}
          triggerTestId="scope-trigger" onScopeKeyChange={key=>{state.calls.push(key);setSelected(key)}}/>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<ZCodeIntlProvider initialLocale="zh-CN"><Fixture/></ZCodeIntlProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const trigger = page.getByTestId("scope-trigger");
  const items = page.getByRole("menuitemradio");
  await trigger.click();
  await page.getByRole("menu").waitFor();
  assert.equal(await items.count(), 9);
  assert.equal(await items.filter({ hasText: "/projects/zcode" }).count(), 3);
  assert.equal(await items.filter({ hasText: "another-parent" }).count(), 1);
  assert.equal(await items.filter({ hasText: "topology" }).innerText(), "topology");
  assert.equal(await items.filter({ hasText: "missing" }).count(), 0);
  assert.equal(await page.locator('[role="menuitemradio"][aria-checked="true"]').count(), 1);
  await page
    .getByRole("menuitemradio", { name: "zcode /worktrees/another-parent/zcode", exact: true })
    .click();
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(
    await trigger.getAttribute("data-plugin-scope-key"),
    "/worktrees/another-parent/zcode",
  );
  assert.equal(await trigger.getAttribute("title"), "/worktrees/another-parent/zcode");

  for (const key of ["ssh:a:/projects/zcode", "ssh:b:/projects/zcode"]) {
    await trigger.click();
    const remote = page
      .locator(`[role="menuitemradio"][data-state]`)
      .filter({ hasText: key.includes(":a:") ? "a.example.invalid" : "b.example.invalid" });
    await remote.click();
    await page.getByRole("menu").waitFor({ state: "detached" });
    assert.equal(await trigger.getAttribute("data-plugin-scope-key"), key);
  }
  // Keyboard selection uses the same original identity key as pointer selection.
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.textContent === "用户");
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("title") === "/projects/zcode",
  );
  await page.keyboard.press("Enter");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(await trigger.getAttribute("data-plugin-scope-key"), "/projects/zcode");
  assert.deepEqual(await page.evaluate(() => window.__scope.calls), [
    "/worktrees/another-parent/zcode",
    "ssh:a:/projects/zcode",
    "ssh:b:/projects/zcode",
    "/projects/zcode",
  ]);

  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await trigger.click();
      await page.getByRole("menu").waitFor();
      assert.equal(await items.count(), 9);
      assert.equal(await page.locator('[role="menuitemradio"][aria-checked="true"]').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const menu = await page.getByRole("menu").boundingBox();
      assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= width);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
    }
  }
  await page.evaluate(() => window.__scope.setExplicit(true));
  await trigger.click();
  await page.getByRole("menu").waitFor();
  assert.equal(await items.count(), 3);
  await page
    .getByRole("menuitemradio", { name: "iot-forway /worktrees/iot-forway", exact: true })
    .click();
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(await trigger.getAttribute("data-plugin-scope-key"), "b");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: identity deduplication, same-name paths, remote isolation, pointer/keyboard selection, explicit options, themes and mobile widths. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
