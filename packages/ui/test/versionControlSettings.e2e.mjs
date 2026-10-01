// Synthetic Hosts only: never reads real credentials or contacts a code-hosting server.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__version-control-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts =
  process.env.ZCODE_E2E_ARTIFACT_DIR ?? (await mkdtemp(join(tmpdir(), "zcode-vc-ui-")));
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
    import {VersionControlSection} from "../../../ui/src/settings/VersionControlSection.tsx";
    import {ServiceProvider} from "../../../ui/src/hooks/useServices.tsx";
    import {PlatformProvider} from "../../../ui/src/hooks/usePlatform.tsx";
    import {ZCodeIntlProvider} from "../../../ui/src/i18n/IntlProvider.tsx";
    import {TooltipProvider} from "../../../ui/src/components/ui/tooltip.tsx";
    import {createSettingsPageConfig} from "../../../ui/src/settings/settingsPageConfig.ts";
    import {consumeInitialSettingsSection, writeLastSettingsSectionPreference} from "../../../ui/src/lib/settingsNavigation.ts";
    import "../../../ui/src/styles.css";
    const state:any={calls:[],pending:[],failNext:false,delayRead:false,delayMutation:false};
    window.__vc=state;
    const clone=(value:any)=>JSON.parse(JSON.stringify(value));
    const snapshots:any={A:{customPath:null,accounts:[]},B:{customPath:'/host-b/git',accounts:[]}};
    const hosts:any={};
    for(const host of ['A','B']) hosts[host]={
      async getVersionControlSettings(){
        if(state.failNext){state.failNext=false;throw new Error('synthetic failure')}
        if(state.delayRead){state.delayRead=false;return new Promise(resolve=>state.pending.push(()=>resolve(clone(snapshots[host]))))}
        return clone(snapshots[host]);
      },
      async detectGit(){return {installed:true,path:snapshots[host].customPath||'/detected/git',version:'git version 2.50.0'}},
      async updateGitPath({path}:any){state.calls.push({operation:'path',host,path});if(path.includes('invalid'))throw new Error('VERSION_CONTROL_INVALID_GIT_PATH');snapshots[host].customPath=path.trim()||null;return this.detectGit()},
      async addGitAccount(request:any){
        state.calls.push({operation:'add',host,...request});
        if(request.secret==='invalid') throw new Error('VERSION_CONTROL_authentication');
        const account={id:crypto.randomUUID(),provider:request.provider,serverUrl:request.serverUrl,username:request.username||request.provider+'-tester',scopes:request.provider==='github'?['repo']:[],avatarUrl:'https://avatar.example.invalid/missing.png',isDefault:snapshots[host].accounts.length===0,createdAt:new Date().toISOString()};
        snapshots[host].accounts.push(account);return clone(snapshots[host]);
      },
      async rotateGitAccount(request:any){state.calls.push({operation:'rotate',host,...request});if(state.delayMutation){state.delayMutation=false;return new Promise(resolve=>state.pending.push(()=>resolve(clone(snapshots[host]))))}return clone(snapshots[host])},
      async testGitAccount(request:any){state.calls.push({operation:'test',host,...request});return {success:true,kind:snapshots[host].accounts.find((a:any)=>a.id===request.accountId)?.provider==='git'?'stored':'forge'}},
      async setDefaultGitAccount(request:any){state.calls.push({operation:'default',host,...request});snapshots[host].accounts=snapshots[host].accounts.map((a:any)=>({...a,isDefault:a.id===request.accountId}));return clone(snapshots[host])},
      async removeGitAccount(request:any){state.calls.push({operation:'remove',host,...request});if(state.failNext){state.failNext=false;throw new Error('synthetic failure')}snapshots[host].accounts=snapshots[host].accounts.filter((a:any)=>a.id!==request.accountId);if(snapshots[host].accounts.length&&!snapshots[host].accounts.some((a:any)=>a.isDefault))snapshots[host].accounts[0].isDefault=true;return clone(snapshots[host])},
    };
    state.finish=()=>state.pending.shift()?.();
    state.navigation=()=>{writeLastSettingsSectionPreference('versionControl');return {section:consumeInitialSettingsSection(),ids:createSettingsPageConfig().settingsSections.map((s:any)=>s.id)}};
    const services:any={A:{gitService:hosts.A},B:{gitService:hosts.B}};
    const platform:any={openExternal:(url:string)=>state.calls.push({operation:'open',url})};
    function Fixture(){
      const [host,setHost]=useState('A');const [visible,setVisible]=useState(true);
      state.switchHost=setHost;state.visible=setVisible;
      return <div className="min-h-screen bg-background text-foreground"><div data-host={host} className="mx-auto max-w-4xl p-4"><ServiceProvider services={services[host]}>{visible?<VersionControlSection/>:null}</ServiceProvider></div></div>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://avatar.example.invalid/**", (route) => route.abort());
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("version-control-settings");
  await panel.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="version-control-settings"]')
        ?.getAttribute("aria-busy") === "false",
  );
  assert.equal(await panel.locator("section[data-testid]").count(), 4);
  const navigation = await page.evaluate(() => window.__vc.navigation());
  assert.equal(navigation.section, "versionControl");
  assert.ok(navigation.ids.indexOf("versionControl") > navigation.ids.indexOf("worktrees"));
  const path = page.locator("#vc-git-path");
  assert.equal(await page.getByTestId("vc-detected-path").textContent(), "/detected/git");
  assert.match(await page.getByTestId("vc-detected-path").locator("..").innerText(), /^路径：/);
  assert.equal(await path.inputValue(), "");
  await path.fill("/invalid/git");
  await path.press("Tab");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByTestId("vc-detected-path").textContent(), "/detected/git");
  await path.fill("/custom/git");
  await path.press("Tab");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="vc-detected-path"]')?.textContent === "/custom/git",
  );
  await path.fill("");
  await path.press("Tab");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="vc-detected-path"]')?.textContent === "/detected/git",
  );
  assert.equal(await path.inputValue(), "");
  await path.fill("/custom/git");
  await path.press("Tab");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="vc-detected-path"]')?.textContent === "/custom/git",
  );
  assert.equal(await panel.getByRole("button", { name: "保存", exact: true }).count(), 0);

  for (const provider of ["github", "gitlab", "gitea", "git"]) {
    await page.getByTestId(`vc-provider-${provider}`).getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    if (provider === "git") {
      await dialog
        .locator("#vc-account-server")
        .fill("https://git.example.invalid/long-project-base");
      await dialog.locator("#vc-account-user").fill("generic-tester-with-a-long-account-name");
    }
    if (provider === "github") {
      assert.doesNotMatch(
        await dialog.innerText(),
        /建议权限|Recommended scopes|tokenHint\.github/,
      );
      assert.equal(await dialog.locator("#vc-account-secret").getAttribute("type"), "password");
      await page.screenshot({ path: join(artifacts, "github-dialog.png") });
      await dialog.locator("#vc-account-secret").fill("invalid");
      await dialog.getByRole("button", { name: "验证并添加", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await page.getByTestId("vc-account").count(), 0);
    }
    await dialog.locator("#vc-account-secret").fill("synthetic-ui-token");
    await dialog.getByRole("button", { name: "显示凭据", exact: true }).click();
    assert.equal(await dialog.locator("#vc-account-secret").getAttribute("type"), "text");
    await dialog.getByRole("button", { name: "隐藏凭据", exact: true }).click();
    if (provider !== "git")
      await dialog.getByRole("button", { name: "生成令牌", exact: true }).click();
    await dialog
      .getByRole("button", { name: provider === "git" ? "添加账号" : "验证并添加", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await page.getByTestId(`vc-provider-${provider}`).getByTestId("vc-account").count(),
      1,
    );
  }
  const github = page.getByTestId("vc-provider-github").getByTestId("vc-account");
  const gitlab = page.getByTestId("vc-provider-gitlab").getByTestId("vc-account");
  await gitlab.getByRole("button", { name: "设为默认", exact: true }).click();
  await gitlab.getByTestId("vc-default").waitFor();
  assert.equal(await github.getByTestId("vc-default").count(), 0);
  await github.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.waitForFunction(() => window.__vc.calls.some((call) => call.operation === "test"));
  const originalId = await github.getAttribute("data-account-id");
  await github.getByRole("button", { name: "更新凭据", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.doesNotMatch(await dialog.innerText(), /建议权限|Recommended scopes|tokenHint\.github/);
  assert.equal(await dialog.locator("#vc-account-server").isDisabled(), true);
  assert.equal(await dialog.locator("#vc-account-secret").inputValue(), "");
  await dialog.locator("#vc-account-secret").fill("rotated-synthetic-token");
  await dialog.getByRole("button", { name: "更新凭据", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await github.getAttribute("data-account-id"), originalId);
  await github.getByRole("button", { name: "删除账号", exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await github.count(), 1);
  await github.getByRole("button", { name: "删除账号", exact: true }).click();
  await page.evaluate(() => {
    window.__vc.failNext = true;
  });
  await dialog.getByRole("button", { name: "删除账号", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await github.count(), 1);
  await dialog.getByRole("button", { name: "删除账号", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await github.count(), 0);

  await page.evaluate(() => window.__vc.visible(false));
  await panel.waitFor({ state: "detached" });
  await page.evaluate(() => window.__vc.visible(true));
  await path.waitFor();
  await page.waitForFunction(() => document.querySelector("#vc-git-path")?.value === "/custom/git");
  assert.equal(await page.getByTestId("vc-account").count(), 3);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 390, 320]) {
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="version-control-settings"]')
            ?.getAttribute("aria-busy") === "false",
      );
      assert.equal(await path.isDisabled(), false);
      await page.setViewportSize({ width, height: 850 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${theme}/${width}: no horizontal overflow`,
      );
      for (const button of await panel.locator("button").all()) {
        const box = await button.boundingBox();
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= width,
          `${theme}/${width}: controls remain visible`,
        );
      }
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
    }
  }

  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    window.__vc.failNext = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  await page.evaluate(() => {
    window.__vc.delayRead = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.__vc.pending.length === 1);
  await page.evaluate(() => window.__vc.switchHost("B"));
  await page.waitForFunction(() => document.querySelector("#vc-git-path")?.value === "/host-b/git");
  await page.evaluate(() => window.__vc.finish());
  assert.equal(await path.inputValue(), "/host-b/git");
  assert.equal(await panel.getByTestId("vc-account").count(), 0);

  await page.getByTestId("vc-provider-git").getByRole("button").first().click();
  await dialog.locator("#vc-account-server").fill("https://b.example.invalid");
  await dialog.locator("#vc-account-user").fill("host-b-tester");
  await dialog.locator("#vc-account-secret").fill("host-b-synthetic-secret");
  await dialog.getByRole("button", { name: "添加账号", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const bAccount = page.getByTestId("vc-provider-git").getByTestId("vc-account");
  await bAccount.getByRole("button", { name: "更新凭据", exact: true }).click();
  await dialog.locator("#vc-account-secret").fill("delayed-synthetic-secret");
  await page.evaluate(() => {
    window.__vc.delayMutation = true;
  });
  await dialog.getByRole("button", { name: "更新凭据", exact: true }).click();
  await page.waitForFunction(() => window.__vc.pending.length === 1);
  await page.evaluate(() => window.__vc.switchHost("A"));
  await page.waitForFunction(() => document.querySelector("#vc-git-path")?.value === "/custom/git");
  await page.evaluate(() => window.__vc.finish());
  await dialog.waitFor({ state: "detached" });
  assert.equal(await panel.getByTestId("vc-account").count(), 3);
  assert.equal(await panel.getAttribute("aria-busy"), "false");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: version control settings CRUD, retry, identity, Host races, desktop/mobile and themes. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
