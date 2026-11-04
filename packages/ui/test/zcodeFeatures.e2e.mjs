import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__zcode-features-${process.pid}`;
const files = [join(renderer, `${name}.html`), join(renderer, `${name}.tsx`)];
const artifacts = await mkdtemp(join(tmpdir(), "zcode-features-e2e-"));
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

  await open("cards");
  const cards = page.locator("[data-zcode-stream-animate]");
  await cards.nth(1).waitFor();
  // 点击真实布局中的标题、图标、空白和按钮；菜单必须位于覆盖层之上。
  for (const position of [
    { x: 110, y: 20 },
    { x: 25, y: 30 },
    { x: 400, y: 30 },
  ])
    await cards.first().click({ position });
  assert.equal((await events()).filter(([kind]) => kind === "preview-web").length, 3);
  await cards.nth(1).click({ position: { x: 120, y: 20 } });
  const file = (await events()).find(([kind]) => kind === "preview-file")[1];
  assert.equal(file.path, "/project-a/report.md");
  assert.equal(file.workspacePath, "/project-a");
  await cards.nth(1).getByRole("button", { name: "选择打开方式" }).click();
  await page.getByRole("menuitem", { name: /Finder|文件管理器/ }).click();
  assert.deepEqual(
    (await events()).find(([kind]) => kind === "reveal"),
    ["reveal", "/project-a/report.md"],
  );
  assert.equal((await events()).filter(([kind]) => kind === "preview-file").length, 1);
  await cards.first().getByRole("button", { name: "打开", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  assert.equal((await events()).filter(([kind]) => kind === "preview-web").length, 5);
  await page.getByRole("button", { name: "WSL reveal rejection" }).click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "editor"));
  await page.screenshot({ path: join(artifacts, "preview-cards.png") });

  await open("plugins");
  const update = page.getByTestId("plugin-settings-update-all");
  await update.waitFor();
  await update.click();
  await page.waitForFunction(
    () => window.__feature.events.filter(([kind]) => kind === "plugin-update").length === 3,
  );
  assert.deepEqual(
    (await events()).filter(([kind]) => kind === "plugin-update").map(([, id]) => id),
    ["one@fixture", "two@fixture", "three@fixture"],
  );
  await page.screenshot({ path: join(artifacts, "plugins-update-all.png") });

  await open("projects");
  const projects = page.getByTestId("settings-projects");
  await projects.getByRole("checkbox", { name: "project-b", exact: true }).check();
  await projects.getByRole("button", { name: /移除.*1|删除.*1/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /取消/ })
    .click();
  assert.ok(
    (await page.evaluate(() => window.__feature.settings.recentProjects)).includes("/project-b"),
  );
  await projects.getByRole("button", { name: /移除.*1|删除.*1/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await page.waitForFunction(
    () => !window.__feature.settings.recentProjects.includes("/project-b"),
  );
  assert.equal(
    (await events()).some(([kind]) => kind === "purge"),
    false,
  );
  await page.screenshot({ path: join(artifacts, "projects-remove.png") });

  await open("projects");
  await projects.getByRole("checkbox", { name: "project-b", exact: true }).check();
  await projects.getByRole("button", { name: /移除.*1|删除.*1/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "同时清理 ZCode 会话及附件数据" })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "purge"));
  assert.equal((await events()).find(([kind]) => kind === "purge")[1].workspacePath, "/project-b");

  await open("remote");
  const sync = page.getByTestId("settings-remote-sync");
  await sync.getByRole("combobox").nth(1).selectOption("/project-a");
  await sync.getByRole("button", { name: "MCP 配置", exact: true }).click();
  await page.getByRole("dialog").getByText("fixture-sync", { exact: true }).waitFor();
  assert.equal(
    (await events()).some(([kind]) => kind === "mcp-import"),
    false,
  );
  // 外部连接目标切换使旧预览失效；重新打开必须使用新目标的路径。
  await page.evaluate(() => {
    const tabs = window.__feature.tabs;
    window.__feature.store.getState().bindWorkspaceIdentity("ssh:fixture:/other", "remote-live");
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
  await sync.getByRole("button", { name: "MCP 配置", exact: true }).click();
  await page.getByRole("dialog").getByText("fixture-sync", { exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "同步已选项" }).click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "mcp-import"));
  const imported = (await events()).find(([kind]) => kind === "mcp-import")[1];
  assert.equal(imported.remoteWorkspacePath, "/other");
  assert.equal(imported.localWorkspacePath, "/project-a");
  assert.equal(imported.overwrite, false);
  await page.keyboard.press("Escape");
  const devices = page.getByTestId("remote-workspace-services");
  await devices.getByRole("textbox").fill("no-match");
  assert.equal(await devices.locator("li").count(), 0);
  await devices.getByRole("textbox").fill("fixture");
  assert.equal(await devices.locator("li").count(), 1);
  await devices.getByRole("button").click();
  await page.getByRole("menuitem", { name: /重启/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确认/ })
    .click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "reconnect"));
  const remoteEvents = await events();
  assert.ok(
    remoteEvents.findIndex(([kind]) => kind === "stop") <
      remoteEvents.findIndex(([kind]) => kind === "reconnect"),
  );
  assert.equal(
    await page.getByTestId("settings-remote-sync").getByRole("button").first().isDisabled(),
    true,
  );
  await page.screenshot({ path: join(artifacts, "remote-services.png") });

  await open("mcp");
  await page.getByPlaceholder("my-mcp-server", { exact: true }).fill("fixture-mcp");
  await page.getByPlaceholder("npx", { exact: true }).fill("node");
  await page
    .getByPlaceholder("-y @modelcontextprotocol/server-memory", { exact: true })
    .fill("server.mjs");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "mcp-save"));
  assert.deepEqual((await events()).find(([kind]) => kind === "mcp-save")[1].config.args, [
    "server.mjs",
  ]);
  await page.getByRole("button", { name: "Toggle JSON" }).click();
  const json = page.locator("textarea").first();
  await json.fill("{");
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await json.fill(
    JSON.stringify({
      "fixture-mcp": {
        type: "http",
        url: "https://example.invalid/mcp",
        headers: { "X-Fixture": "one" },
      },
    }),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(
    () => window.__feature.events.filter(([kind]) => kind === "mcp-save").length === 2,
  );
  assert.equal(
    (await events()).filter(([kind]) => kind === "mcp-save").at(-1)[1].config.headers["X-Fixture"],
    "one",
  );
  await page.getByRole("button", { name: /删除/ }).click();
  await page.waitForFunction(() => window.__feature.events.some(([kind]) => kind === "mcp-delete"));
  await page.screenshot({ path: join(artifacts, "mcp-config.png") });
  await open("unread");
  await page.locator('[data-task="read"]').waitFor();
  await page.getByRole("button", { name: "未读筛选" }).click();
  await page.locator('[data-task="read"]').waitFor({ state: "hidden" });
  await page.locator('[data-task="unread"]').click();
  await page.locator('[data-task="unread"]').waitFor({ state: "hidden" });
  const query = (await events()).filter(([kind]) => kind === "task-query").at(-1)[1];
  assert.equal(query.kind, "unread");
  assert.ok(query.workspaceScopes.some((scope) => scope.workspaceIdentity === "ssh:fixture:/same"));
  await page.getByRole("button", { name: "未读筛选" }).click();
  await page.locator('[data-task="read"]').waitFor();
  await page.locator('[data-task="unread"]').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS preview/reveal, plugin partial updates, project cancel/remove/cleanup, sync preview/target invalidation/import, remote search/restart ordering, MCP form/JSON, unread refresh.",
    artifacts,
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
