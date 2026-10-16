// Real settings page, synthetic services; no user history, Git writes or live Host.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const name = `__worktree-responsive-${process.pid}`;
const html = join(desktop, "src/renderer", `${name}.html`);
const moduleFile = join(desktop, "src/renderer", `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-worktree-responsive-"));
let server, browser, page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>window.zcode={};</script><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {SettingsPage} from '../../../ui/src/SettingsPage.tsx';
    import {ManagedWorktreesList} from '../../../ui/src/settings/ManagedWorktreesList.tsx';
    import {ConfirmDialogHost} from '../../../ui/src/ConfirmDialog.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {listenWorktreeSettingsConversation} from '../../../ui/src/lib/worktreeSettingsNavigation.ts';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const root='/synthetic/worktrees';
    const paths=[root+'/011d/repository-with-a-long-name',root+'/0d5e8b68/repository-with-a-long-name'];
    const branches=['worktree/011d','merge/'+ 'long-branch-name-'.repeat(8)];
    const state:any={scans:0,removals:[],created:[],navigation:[],paths};
    window.__worktrees=state;state.setTheme=applyTheme;
    listenWorktreeSettingsConversation(target=>state.navigation.push(target));
    const broadcast:any={send:async()=>{},onMessage:()=>({dispose(){}})};
    const services:any={
      settingService:{get:async()=>({worktreeRootDirectory:root}),update:async()=>{}},
      systemService:{info:async()=>({homedir:'/synthetic',platform:'darwin'})},
      broadcastService:broadcast,
      gitService:{listManagedWorktrees:async()=>{state.scans++;return [{projectPath:'/synthetic/projects/repository-with-a-long-name',worktrees:paths.map((worktreePath,i)=>({worktreePath,branchName:branches[i]}))}]},removeManagedWorktree:async args=>{state.removals.push(args);return {ok:true}}},
      zcodeTaskService:{listTasks:async({workspacePath})=>[{taskId:'api',workspacePath,title:'Long API conversation title '.repeat(8),updatedAt:100}],listPinnedTasks:async()=>[]},
      acpService:{list:async({workspacePath})=>[{id:'acp',workspacePath,agent:'codex',title:'智能体对话标题'.repeat(12),status:'idle',entries:[{kind:'user',text:'synthetic',createdAt:200}]}]},
    };
    function Fixture(){
      const [locale,setLocale]=useState('zh-CN'),[narrow,setNarrow]=useState(false);
      state.setLocale=setLocale;state.setNarrow=setNarrow;
      return <PlatformProvider platform={{isWeb:true,onSettingsChanged:()=>()=>{}} as any}><ServiceProvider services={services}><StoreProvider broadcastService={broadcast}><TabStoreProvider><ZCodeIntlProvider key={locale} initialLocale={locale}><TooltipProvider>
        {narrow?<main style={{width:280,margin:16}}><ManagedWorktreesList root={root}/></main>:<SettingsPage isDesktop={false} onCreateTask={request=>state.created.push(request)}/>}
        <ConfirmDialogHost/>
      </TooltipProvider></ZCodeIntlProvider></TabStoreProvider></StoreProvider></ServiceProvider></PlatformProvider>;
    }
    createRoot(document.getElementById('root')!).render(<Fixture/>);
  `,
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: join(desktop, "src/renderer"),
    server: { host: "127.0.0.1", port: 19000 + (process.pid % 20000), strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  const labels = {
    "zh-CN": {
      section: "工作树",
      create: "在工作树中新建对话",
      remove: "删除",
      cancel: "取消",
      refresh: "刷新工作树列表",
    },
    "en-US": {
      section: "Worktrees",
      create: "New conversation in worktree",
      remove: "Delete",
      cancel: "Cancel",
      refresh: "Refresh worktrees",
    },
  };
  // Also validate a narrow card in a wide viewport, independently of media breakpoints.
  async function checkCards(context) {
    const trees = page.getByTestId("managed-worktree");
    await trees.nth(1).waitFor();
    for (const [index, tree] of (await trees.all()).entries()) {
      const layout = await tree.evaluate((el) => {
        const header = el.firstElementChild,
          [info, actions] = header.children;
        const h = header.getBoundingClientRect(),
          i = info.getBoundingClientRect(),
          a = actions.getBoundingClientRect();
        const descendants = [info, ...info.children, ...actions.children];
        return {
          width: h.width,
          innerWidth: header.clientWidth - 32,
          infoWidth: i.width,
          stacked: a.top >= i.bottom - 1,
          overflow: descendants.some((node) => {
            const r = node.getBoundingClientRect();
            return (
              node.scrollWidth > node.clientWidth + 1 ||
              r.right > h.right + 1 ||
              r.left < h.left - 1
            );
          }),
          overlap: a.left < i.right && a.right > i.left && a.top < i.bottom && a.bottom > i.top,
        };
      });
      await tree.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(artifacts, `${context}-tree-${index}.png`),
        animations: "disabled",
      });
      assert.equal(
        layout.overflow,
        false,
        `${context}: text/buttons overflow ${JSON.stringify(layout)}`,
      );
      assert.equal(layout.overlap, false, `${context}: text overlaps actions`);
      if (layout.width < 512) {
        assert.ok(
          layout.infoWidth >= layout.innerWidth * 0.95,
          `${context}: full-width information ${JSON.stringify(layout)}`,
        );
        assert.ok(layout.stacked, `${context}: actions below information`);
      } else assert.equal(layout.stacked, false, `${context}: wide cards retain inline actions`);
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "No page overflow",
    );
  }
  for (const locale of ["zh-CN", "en-US"]) {
    const text = labels[locale];
    await page.evaluate((locale) => window.__worktrees.setLocale(locale), locale);
    await page.getByRole("button", { name: text.section, exact: true }).click();
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => window.__worktrees.setTheme(theme), theme);
      for (const width of [320, 375, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await checkCards(`${locale}-${theme}-${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    const tree = page.getByTestId("managed-worktree").first();
    await tree.getByRole("button", { name: text.create, exact: true }).tap();
    assert.equal(
      await page.evaluate(() => window.__worktrees.created.at(-1).targetWorkspace.workspacePath),
      "/synthetic/worktrees/011d/repository-with-a-long-name",
    );
    await tree.getByRole("button", { name: /Long API conversation title/ }).tap();
    await page.waitForFunction(() => window.__worktrees.navigation.at(-1)?.kind === "api");
    await tree.getByRole("button", { name: /CODEX$/ }).tap();
    await page.waitForFunction(() => window.__worktrees.navigation.at(-1)?.kind === "acp");
    assert.equal(
      await page.evaluate(() => window.__worktrees.navigation.at(-1).session.workspacePath),
      "/synthetic/worktrees/011d/repository-with-a-long-name",
    );
    await tree.getByRole("button", { name: text.remove, exact: true }).tap();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog
      .getByRole("button", { name: new RegExp(`^${text.cancel}\\b|^${text.cancel}\\s`) })
      .tap();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.__worktrees.removals.length), 0);
    const scans = await page.evaluate(() => window.__worktrees.scans);
    await page.getByRole("button", { name: text.refresh, exact: true }).tap();
    await page.waitForFunction((scans) => window.__worktrees.scans > scans, scans);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.__worktrees.setNarrow(true));
  await checkCards("wide-viewport-narrow-container");
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: real worktree settings, mobile/desktop, zh/en, Zai light/dark, narrow container, touch navigation/create/refresh/delete cancellation. Screenshots: ${artifacts}\n`,
  );
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}\nArtifacts: ${artifacts}`, {
    cause: error,
  });
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
