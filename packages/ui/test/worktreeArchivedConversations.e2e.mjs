// Real worktree settings with synthetic service metadata; no user history or model requests.
// Run against desktop Vite: node packages/ui/test/worktreeArchivedConversations.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-archived-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const baseUrl = process.env.ZCODE_E2E_BASE_URL || "http://localhost:5174";
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ManagedWorktreesList } from '../../../ui/src/settings/ManagedWorktreesList.tsx';
    import { PlatformProvider } from '../../../ui/src/hooks/usePlatform.tsx';
    import { ServiceProvider } from '../../../ui/src/hooks/useServices.tsx';
    import { TabStoreProvider } from '../../../ui/src/store/TabStoreProvider.tsx';
    import { ZCodeIntlProvider } from '../../../ui/src/i18n/IntlProvider.tsx';
    import { TooltipProvider } from '../../../ui/src/components/ui/tooltip.tsx';
    import { listenWorktreeSettingsConversation } from '../../../ui/src/lib/worktreeSettingsNavigation.ts';
    import '../../../ui/src/styles.css';
    const treePath = '/fixture/worktrees/ab12/repo';
    const emptyPath = '/fixture/worktrees/cd34/repo';
    const task = (id, updatedAt, pinned = false, archived = false, workspacePath = treePath) =>
      ({taskId:id, title:id, workspacePath, updatedAt, pinned, archived});
    const api = [task('API ordinary',100), task('API pinned',300,true),
      task('API archived',900,false,true), task('API archived-only',900,false,true,emptyPath)];
    const session = (id, updatedAt, pinned = false, archived = false, workspacePath = treePath) =>
      ({id, title:id, agent:'codex', workspacePath, status:'idle', pinned, archived,
        entries:[{id:'user:'+id, kind:'user', text:id, createdAt:updatedAt}]});
    const acp = [session('ACP ordinary',200),session('ACP pinned',400,true),
      session('ACP archived',1000,false,true),session('ACP pinned archived',1100,true,true),
      session('ACP archived-only',1000,false,true,emptyPath)];
    window.__archiveQueries = 0;
    window.__navigation = [];
    listenWorktreeSettingsConversation(target => window.__navigation.push(target));
    window.__setArchived = archived => {
      api.find(t=>t.taskId==='API ordinary').archived=archived;
      acp.find(s=>s.id==='ACP ordinary').archived=archived;
    };
    window.__history = () => ({api:api.length,acp:acp.length});
    const services = {
      gitService:{listManagedWorktrees:async()=>[{projectPath:'/fixture/repo',worktrees:[
        {worktreePath:treePath,branchName:'worktree/ab12'},
        {worktreePath:emptyPath,branchName:'worktree/cd34'}]}]},
      zcodeTaskService:{
        listTasks:async ({workspacePath})=>api.filter(t=>t.workspacePath===workspacePath&&!t.pinned&&!t.archived),
        listPinnedTasks:async ({workspacePath})=>api.filter(t=>t.workspacePath===workspacePath&&t.pinned&&!t.archived),
        listArchivedTasks:async ({workspacePath})=>{window.__archiveQueries++;return api.filter(t=>t.workspacePath===workspacePath&&t.archived)},
      },
      acpService:{list:async({workspacePath})=>acp.filter(s=>s.workspacePath===workspacePath)},
    };
    createRoot(document.getElementById('root')!).render(
      <PlatformProvider platform={{isWeb:true,isMacOS:false,isWindows:false,isLinux:true} as never}>
        <TabStoreProvider><ServiceProvider services={services as never}>
          <ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
            <main style={{maxWidth:720,margin:'12px'}}><ManagedWorktreesList root="/fixture/worktrees"/></main>
          </TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
      </PlatformProvider>);
    `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/${name}.html`);
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("dark", value === "dark"),
        theme,
      );
      const list = page.getByTestId("managed-worktrees");
      const tree = list.getByTestId("managed-worktree").nth(0);
      const emptyTree = list.getByTestId("managed-worktree").nth(1);
      const titles = async () =>
        (await tree.locator("button").allTextContents()).slice(2).map((text) =>
          text
            .trim()
            .replace(/(?:API|CODEX)$/, "")
            .trim(),
        );
      await tree.getByRole("button", { name: "API ordinary API", exact: true }).waitFor();
      assert.deepEqual(await titles(), [
        "ACP pinned",
        "API pinned",
        "ACP ordinary",
        "API ordinary",
      ]);
      assert.equal(await list.getByRole("button", { name: /archived/ }).count(), 0);
      await emptyTree.getByText("暂无对话", { exact: true }).waitFor();
      assert.equal(await list.getByTestId("managed-worktree").count(), 2);
      assert.equal(await list.getByRole("alert").count(), 0);

      await page.evaluate(() => window.__setArchived(true));
      await list.getByRole("button", { name: "刷新工作树列表", exact: true }).click();
      await tree
        .getByRole("button", { name: "API ordinary API", exact: true })
        .waitFor({ state: "detached" });
      await tree.getByRole("button", { name: "ACP pinned CODEX", exact: true }).waitFor();
      assert.deepEqual(await titles(), ["ACP pinned", "API pinned"]);

      await page.evaluate(() => window.__setArchived(false));
      await list.getByRole("button", { name: "刷新工作树列表", exact: true }).click();
      const apiRow = tree.getByRole("button", { name: "API ordinary API", exact: true });
      const acpRow = tree.getByRole("button", { name: "ACP ordinary CODEX", exact: true });
      await apiRow.waitFor();
      await apiRow.click();
      await acpRow.click();
      const navigation = await page.evaluate(() => window.__navigation);
      assert.deepEqual(navigation[0], {
        kind: "api",
        workspacePath: "/fixture/worktrees/ab12/repo",
        taskId: "API ordinary",
      });
      assert.equal(navigation[1].kind, "acp");
      assert.equal(navigation[1].session.id, "ACP ordinary");
      assert.equal(navigation[1].session.workspacePath, "/fixture/worktrees/ab12/repo");
      assert.equal(await page.evaluate(() => window.__archiveQueries), 0);
      assert.deepEqual(await page.evaluate(() => window.__history()), { api: 4, acp: 5 });
      assert.equal(await list.evaluate((el) => el.scrollWidth > el.clientWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    "PASS: worktree settings hide archived API/ACP, retain pinned and empty worktrees, refresh archive/unarchive and preserve navigation/history in both widths/themes.\n",
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
