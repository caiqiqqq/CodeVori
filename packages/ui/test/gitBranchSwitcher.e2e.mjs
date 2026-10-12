// Real branch menu/hooks with synthetic Git responses. Run against an isolated desktop Vite server.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__git-branch-switcher-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-branch-switcher-e2e-"));
const current = "feature/当前很长的分支名称-current-branch-name-without-spaces";
const occupied = "feature/已经占用的长分支名称-occupied-branch-name-without-spaces";
const free = "feature/空闲的长分支名称-free-branch-name-without-spaces";
const worktreePath = "/synthetic/工作树 with space/occupied-repository";
const errors = [];
let browser;
let page;

try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {GitBranchSwitcher} from '../../../ui/src/GitBranchSwitcher.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const current=${JSON.stringify(current)},occupied=${JSON.stringify(occupied)},free=${JSON.stringify(free)},path=${JSON.stringify(worktreePath)};
    const summary={workspacePath:'/synthetic/repository',repoRoot:'/synthetic/repository',isGitAvailable:true,isRepository:true,branchName:current,headRefType:'branch',isDirty:false,ahead:0,behind:0};
    const state={calls:[],reads:0,refreshes:0,blocked:true,legacy:false,race:false};window.__branch=state;
    const services={gitService:{getLocalBranches:async()=>{
      state.reads++;return {currentBranchName:current,headRefType:'branch',branches:[current,occupied,free].map(name=>({name,isCurrent:name===current,upstreamName:null,commitHash:null,commitTimestampMs:null,...(state.legacy?{}:{worktreePath:name===current?'/synthetic/repository':name===occupied&&state.blocked?path:null})}))};
    },switchBranch:async request=>{
      state.calls.push(request);
      return state.race?{ok:false,action:'switch',branchName:request.targetBranchName,didChange:false,created:false,summary,issues:[{code:'branch-in-other-worktree',message:'Branch is already checked out in another worktree.',detail:"fatal: raw Git error",paths:[path]}]}:{ok:true,action:'switch',branchName:request.targetBranchName,didChange:request.targetBranchName!==current,created:false,summary:{...summary,branchName:request.targetBranchName},issues:[]};
    }}};
    const locale=new URLSearchParams(location.search).get('locale')??'zh-CN';
    createRoot(document.getElementById('root')).render(<ServiceProvider services={services}><ZCodeIntlProvider initialLocale={locale}><TooltipProvider><main className="bg-background text-foreground min-h-dvh p-4"><GitBranchSwitcher workspacePath={summary.workspacePath} gitSummary={summary} dirtyFileCount={0} onRefreshGit={()=>state.refreshes++} popoverSide="bottom"/></main></TooltipProvider></ZCodeIntlProvider></ServiceProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });

  for (const mobile of [false, true]) {
    for (const dark of [false, true]) {
      page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1000, height: 800 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.text().includes("changing from") ||
          message.text().includes("Maximum update depth")
        )
          errors.push(message.text());
      });
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      const trigger = page.getByRole("button", { name: "切换 Git 分支", exact: true });
      await trigger.waitFor();
      await trigger.hover();
      await page.getByRole("tooltip").waitFor();
      assert.equal(await page.getByRole("tooltip").innerText(), current);
      const bounds = await page.getByRole("tooltip").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1000));
      await page.mouse.move(0, 0);
      await trigger.click();
      const option = (name) =>
        page.locator(`[data-slot="command-item"][data-value=${JSON.stringify(name)}]`);
      await option(occupied).waitFor();
      assert.equal(await option(occupied).getAttribute("aria-disabled"), "true");
      assert.ok((await option(occupied).innerText()).includes(worktreePath));
      assert.equal(await option(occupied).locator("[title]").getAttribute("title"), occupied);
      if (mobile) {
        assert.equal(
          await option(occupied)
            .locator("[title]")
            .evaluate((node) => getComputedStyle(node).whiteSpace),
          "normal",
        );
      }
      await page.getByRole("tooltip").waitFor({ state: "hidden" });
      await page.screenshot({
        path: join(artifacts, `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}.png`),
        animations: "disabled",
      });
      await option(occupied).click({ force: true });
      assert.equal(await page.evaluate(() => window.__branch.calls.length), 0);

      const search = page.getByPlaceholder("搜索分支", { exact: true });
      await search.fill(occupied);
      await search.press("Enter");
      await search.press("Tab");
      assert.equal(await page.evaluate(() => window.__branch.calls.length), 0);
      await search.fill(free);
      await search.press("ArrowDown");
      await search.press("Enter");
      await page.waitForFunction(() => window.__branch.calls.length === 1);
      assert.equal(await page.evaluate(() => window.__branch.calls[0].targetBranchName), free);
      assert.equal(await page.evaluate(() => window.__branch.refreshes), 1);

      // Current branch remains selectable and does not refresh on a no-op.
      await trigger.click();
      await search.fill("");
      await option(current).waitFor();
      assert.notEqual(await option(current).getAttribute("aria-disabled"), "true");
      await option(current).click();
      await page.waitForFunction(() => window.__branch.calls.length === 2);
      assert.equal(await page.evaluate(() => window.__branch.refreshes), 1);

      // The next open refreshes occupancy; older Hosts may omit the new optional field.
      await page.evaluate(() => {
        window.__branch.blocked = false;
      });
      await trigger.click();
      await search.fill("");
      await page.waitForFunction(
        (name) =>
          document
            .querySelector(`[data-slot="command-item"][data-value="${name}"]`)
            ?.getAttribute("aria-disabled") === "false",
        occupied,
      );
      await option(occupied).click();
      await page.waitForFunction(() => window.__branch.calls.length === 3);
      await page.evaluate(() => {
        window.__branch.legacy = true;
        window.__branch.blocked = true;
        window.__branch.race = true;
      });
      await trigger.click();
      await search.fill("");
      await page.waitForFunction(() => window.__branch.reads >= 4);
      await option(occupied).click();
      await page.waitForFunction(() => window.__branch.calls.length === 4);
      await page.getByText(new RegExp("分支.*已在其他工作树")).first().waitFor();
      const toastText = await page.locator("body").innerText();
      assert.ok(toastText.includes(occupied) && toastText.includes(worktreePath));
      assert.ok(!toastText.includes("fatal: raw Git error"));
      assert.equal(await page.evaluate(() => window.__branch.refreshes), 2);
      assert.equal(await page.locator('[data-slot="dialog-content"]').count(), 0);
      await page.close();
      console.log(
        `PASS: ${mobile ? "mobile" : "desktop"} ${dark ? "dark" : "light"} full names, occupancy, keyboard safety, refresh and late conflict`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(
    await page
      ?.locator('[data-slot="command-item"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ value: node.getAttribute("data-value"), text: node.textContent })),
      ),
  );
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  console.error({ errors, artifacts });
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
