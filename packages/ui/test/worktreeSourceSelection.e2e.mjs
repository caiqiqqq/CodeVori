// Real branch picker and shell selection hook; synthetic services, no user files or Agent calls.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-source-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-worktree-source-e2e-"));
const source = "feature/来源分支-occupied-source-with-a-long-name";
const free = "feature/free";
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
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {GitBranchSwitcher} from '../../../ui/src/GitBranchSwitcher.tsx';
    import {useWorktreeDraftSelection} from '../../../ui/src/hooks/useWorktreeDraftSelection.ts';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const source=${JSON.stringify(source)},free=${JSON.stringify(free)};
    const state:any={creates:[],switches:[],reads:[],refreshes:0,pendingReads:[],pendingSettings:[],slowRead:false,slowSettings:false,fail:false,results:[],settled:null,root:'/synthetic/trees'};window.__source=state;
    const services:any={settingService:{get:async()=>state.slowSettings?new Promise(resolve=>state.pendingSettings.push(()=>resolve({worktreeRootDirectory:state.root}))):({worktreeRootDirectory:state.root})},systemService:{info:async()=>({homedir:'/synthetic/home'})},gitService:{
      getLocalBranches:async({workspacePath})=>{state.reads.push(workspacePath);const response={headRefType:'branch',currentBranchName:'main',branches:(workspacePath==='/synthetic/other'?['other-only']:['main',source,free]).map(name=>({name,isCurrent:name==='main',upstreamName:null,commitHash:null,commitTimestampMs:null,worktreePath:name===source?'/synthetic/occupied':name==='main'?workspacePath:null}))};return state.slowRead?new Promise(resolve=>state.pendingReads.push(()=>resolve(response))):response},
      switchBranch:async request=>{state.switches.push(request);throw new Error('Source selection must never switch Git')},
      createAutomaticWorktree:async request=>{state.creates.push(request);return state.fail?{ok:false,branchName:null,worktreePath:'',didCreate:false,issues:[{code:'target-branch-not-found',message:'source missing'}]}:{ok:true,branchName:'worktree/cafe',worktreePath:'/synthetic/trees/cafe/repo',didCreate:true,issues:[]}}
    }};
    function Fixture(){
      const [scope,setScope]=useState({workspacePath:'/synthetic/repo',workspaceIdentity:undefined,draftFocusVersion:1,sessionId:null});
      const [head,setHead]=useState('main');
      const intent=useWorktreeDraftSelection(scope);
      state.scope=scope;state.setScope=value=>setScope(old=>({...old,...value}));state.setHead=setHead;state.intent=intent;
      state.resolveReads=()=>state.pendingReads.splice(0).forEach(resolve=>resolve());state.resolveSettings=()=>state.pendingSettings.splice(0).forEach(resolve=>resolve());
      state.send=()=>intent.createWorktree().then(result=>state.results.push(result),error=>state.results.push({error:error.message}));
      state.sendTwice=()=>Promise.allSettled([intent.createWorktree(),intent.createWorktree()]).then(value=>state.settled=value.map(item=>({status:item.status,...(item.status==='rejected'?{error:item.reason.message}:{})})));
      const summary={workspacePath:scope.workspacePath,repoRoot:scope.workspacePath,isGitAvailable:true,isRepository:true,branchName:head,headRefType:'branch',isDirty:true,ahead:0,behind:0};
      return <main className="bg-background text-foreground min-h-dvh p-4"><GitBranchSwitcher workspacePath={scope.workspacePath} gitSummary={summary} dirtyFileCount={2} onRefreshGit={()=>state.refreshes++} allowWorktreeCreation={!scope.workspaceIdentity&&scope.sessionId===null} worktreeSelected={intent.selected} worktreeSourceBranchName={intent.sourceBranchName} worktreeCreating={intent.creating} onWorktreeSelectedChange={intent.select} popoverSide="bottom"/><div data-testid="facts" data-selected={intent.selected} data-source={intent.sourceBranchName??''} data-creating={intent.creating}/></main>;
    }
    createRoot(document.getElementById('root')).render(<ServiceProvider services={services}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></ServiceProvider>);
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
        if (/changing from|Maximum update depth/.test(message.text())) errors.push(message.text());
      });
      await page.goto(`${origin}/${name}.html`);
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      const trigger = page.getByRole("button", { name: "切换 Git 分支", exact: true });
      const option = (name) =>
        page.locator(`[data-slot="command-item"][data-value=${JSON.stringify(name)}]`);
      const selected = (value) =>
        page.waitForFunction(
          (value) =>
            document.querySelector('[data-testid="facts"]')?.getAttribute("data-source") === value,
          value,
        );
      const enterPicker = async () => {
        await trigger.click();
        await page.getByRole("button", { name: "新建工作树", exact: true }).click();
        await page.getByText("选择工作树来源分支", { exact: true }).waitFor();
      };
      await trigger.click();
      await option(source).waitFor();
      assert.equal(await option(source).getAttribute("aria-disabled"), "true");
      await page.getByRole("button", { name: "新建工作树", exact: true }).click();
      await page.getByText("选择工作树来源分支", { exact: true }).waitFor();
      assert.equal(await option(source).getAttribute("aria-disabled"), "false");
      assert.equal(await page.getByTestId("worktree-draft-selected").count(), 0);
      assert.equal(await page.evaluate(() => window.__source.creates.length), 0);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await selected("");
      await enterPicker();
      await page.getByRole("tooltip").waitFor({ state: "hidden" });
      await page.screenshot({
        path: join(
          artifacts,
          `${mobile ? "mobile" : "desktop"}-${dark ? "dark" : "light"}-picker.png`,
        ),
        animations: "disabled",
      });
      await page.getByPlaceholder("搜索分支", { exact: true }).fill(source);
      await page.getByPlaceholder("搜索分支", { exact: true }).press("ArrowDown");
      await page.getByPlaceholder("搜索分支", { exact: true }).press("Enter");
      await selected(source);
      assert.ok((await trigger.innerText()).includes(source));
      await page.evaluate(() => window.__source.sendTwice());
      await page.waitForFunction(() => window.__source.settled?.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__source.creates), [
        {
          workspacePath: "/synthetic/repo",
          worktreeRootPath: "/synthetic/trees",
          sourceBranchName: source,
        },
      ]);
      assert.equal(
        (await page.evaluate(() => window.__source.settled)).filter(
          (item) => item.status === "fulfilled",
        ).length,
        1,
      );
      assert.equal(await page.evaluate(() => window.__source.switches.length), 0);
      assert.equal(await page.evaluate(() => window.__source.refreshes), 0);
      // Reopen selects the source, never the repository HEAD. Changing it is only a draft edit.
      await trigger.click();
      await option(free).click();
      await selected(free);
      assert.equal(await page.evaluate(() => window.__source.creates.length), 1);
      await trigger.click();
      await page.getByRole("button", { name: "取消新建工作树", exact: true }).click();
      await selected("");
      await enterPicker();
      await option(source).click();
      await selected(source);
      await page.evaluate(() => {
        window.__source.setHead("externally-changed");
        window.__source.root = "/synthetic/changed-root";
      });
      await selected(source);
      await page.evaluate(() => window.__source.send());
      await page.waitForFunction(() => window.__source.creates.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__source.creates[1]), {
        workspacePath: "/synthetic/repo",
        worktreeRootPath: "/synthetic/changed-root",
        sourceBranchName: source,
      });
      await page.evaluate(() => {
        window.__source.fail = true;
        window.__source.send();
      });
      await page.waitForFunction(() => window.__source.results.at(-1)?.ok === false);
      await selected(source);
      // An in-flight settings read must not create in a workspace the user has left.
      await page.evaluate(() => {
        window.__source.slowSettings = true;
        window.__source.send();
      });
      await page.waitForFunction(() => window.__source.pendingSettings.length === 1);
      await page.evaluate(() => window.__source.setScope({ workspacePath: "/synthetic/other" }));
      await selected("");
      await page.evaluate(() => window.__source.resolveSettings());
      await page.waitForFunction(
        () => window.__source.results.at(-1)?.error === "stale-worktree-selection",
      );
      assert.equal(await page.evaluate(() => window.__source.creates.length), 3);
      // A delayed list from the previous workspace must never be available as a source here.
      await page.evaluate(() => {
        window.__source.slowRead = true;
        window.__source.setScope({ workspacePath: "/synthetic/repo" });
      });
      await trigger.click();
      await page.waitForFunction(() => window.__source.pendingReads.length === 1);
      await page.evaluate(() => {
        window.__source.setScope({ workspacePath: "/synthetic/other" });
        window.__source.slowRead = false;
      });
      await page.getByPlaceholder("搜索分支", { exact: true }).waitFor({ state: "hidden" });
      await trigger.click();
      await option("other-only").waitFor();
      await page.evaluate(() => window.__source.resolveReads());
      assert.equal(await option(source).count(), 0);
      await page.getByRole("button", { name: "新建工作树", exact: true }).click();
      await option("other-only").click();
      await selected("other-only");
      // Leaving and returning to the same scope must still invalidate the original settings read.
      const beforeRoundTrip = await page.evaluate(() => ({
        results: window.__source.results.length,
        creates: window.__source.creates.length,
      }));
      await page.evaluate(() => {
        window.__source.send();
      });
      await page.waitForFunction(() => window.__source.pendingSettings.length === 1);
      await page.evaluate(() => window.__source.setScope({ workspacePath: "/synthetic/repo" }));
      await page.waitForFunction(() => window.__source.scope.workspacePath === "/synthetic/repo");
      await selected("");
      await page.evaluate(() => window.__source.setScope({ workspacePath: "/synthetic/other" }));
      await page.waitForFunction(() => window.__source.scope.workspacePath === "/synthetic/other");
      await page.evaluate(() => window.__source.resolveSettings());
      await page.waitForFunction(
        (length) => window.__source.results.length > length,
        beforeRoundTrip.results,
      );
      assert.equal(
        await page.evaluate(() => window.__source.results.at(-1)?.error),
        "stale-worktree-selection",
      );
      assert.equal(
        await page.evaluate(() => window.__source.creates.length),
        beforeRoundTrip.creates,
      );
      await enterPicker();
      await option("other-only").click();
      await selected("other-only");
      await page.evaluate(() => window.__source.setScope({ draftFocusVersion: 2 }));
      await selected("");
      await page.evaluate(() => window.__source.setScope({ workspaceIdentity: "remote-scope" }));
      await trigger.click();
      assert.equal(await page.getByRole("button", { name: "新建工作树", exact: true }).count(), 0);
      await page.evaluate((source) => window.__source.intent.select(true, source), source);
      await selected("");
      await page.close();
      console.log(
        `PASS: ${mobile ? "mobile" : "desktop"} ${dark ? "dark" : "light"} source selection, occupied sources, cancellation, frozen intent, one creation, scope and stale-read guards`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  console.error({ errors, artifacts });
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
