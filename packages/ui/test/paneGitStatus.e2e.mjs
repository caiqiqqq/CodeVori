// Real Git hooks and status panel; synthetic services only, no Agent or real workspace IO.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__pane-git-${process.pid}`;
const html = join(renderer, `${name}.html`),
  moduleFile = join(renderer, `${name}.tsx`);
const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://localhost:5174";
const artifacts = await mkdtemp(join(tmpdir(), "zcode-pane-git-"));
let browser;
let page;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStore,useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {usePaneGitStatus} from '../../../ui/src/hooks/usePaneGitStatus.ts';
    import {useScopedGitReview} from '../../../ui/src/hooks/useScopedGitReview.ts';
    import {ConversationStatusPanel} from '../../../ui/src/v4/ConversationStatusPanel.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {buildRemoteWorkspaceIdentity} from '@zcode/shared';
    import '../../../ui/src/styles.css';
    const calls=[],reviews=[],pending=[];
    let mode='dirty';
    const makeServices=host=>({gitService:{refresh:async({workspacePath})=>{
      calls.push({host,workspacePath});
      const response={summary:{workspacePath,repoRoot:workspacePath,autoRefreshWatchPaths:[],branchName:host+':'+workspacePath,isGitAvailable:true,isRepository:mode!=='non-repository',isDirty:mode!=='clean',headRefType:'branch',ahead:0,behind:0},unstagedChanges:mode==='clean'?[]:[{path:'fixture.ts',kind:'modified',section:'unstaged',added:host==='remote'?44:24,removed:5}],stagedChanges:[]};
      if(mode==='error')throw new Error('synthetic Git unavailable');
      if(mode==='slow')return new Promise(resolve=>pending.push(()=>resolve(response)));
      return response;
    }},systemService:{info:async()=>({platform:'darwin'})},fileWatcherService:{watch:async()=>({id:'fixture'}),unwatch:async()=>{},onDynamicChange:()=>()=>({dispose:()=>{}})}});
    const services=makeServices('local');
    const remoteScope={workspacePath:'/fixture/b',workspaceIdentity:buildRemoteWorkspaceIdentity('/fixture/b',{kind:'docker',container:'fixture-container'})};
    const registry=useRemoteWorkspaceSessionStore.getState();registry.registerBaseServices(services);
    function Fixture(){
      const [scope,setScope]=useState({workspacePath:'/fixture/b'}),[enabled,setEnabled]=useState(true),[ready,setReady]=useState(true),[variant,setVariant]=useState('mini');
      const tabs=useTabStoreApi();
      const selected=useTabStore(state=>state.tabs.find(tab=>tab.id===state.activeTabId));
      const current=selected?.kind==='workspace'?{workspacePath:selected.workspacePath,workspaceIdentity:selected.workspaceIdentity,remoteSessionId:selected.remoteSessionId}:{workspacePath:'/fixture/a'};
      const open=useScopedGitReview({scope:current,rpcReady:ready,readOnly:false,onOpenGitReview:sourceId=>reviews.push({scope:current,sourceId})});
      const git=usePaneGitStatus(scope,enabled,open);
      window.__git={calls,reviews,remoteScope,current,setScope,setEnabled,setReady,setMode:value=>{mode=value},resolveSlow:()=>pending.splice(0).forEach(resolve=>resolve()),review:open,navigate:scope=>{const id=tabs.getState().ensureWorkspaceTab(scope.workspacePath,scope);tabs.getState().activateTab(id)},markReadOnly:scope=>tabs.getState().ensureWorkspaceTab(scope.workspacePath,{...scope,availability:'unavailable-local-directory'}),connect:()=>{registry.registerSession({sessionId:'fixture-attachment',services:makeServices('remote')});registry.bindWorkspaceIdentity(remoteScope.workspaceIdentity,'fixture-attachment')},disconnect:()=>registry.unregisterSession('fixture-attachment')};
      return <div className='relative h-dvh p-4'><div data-testid='facts' data-branch={git.gitSummary.branchName??''} data-added={git.gitWorktreeChangeSummary.added} data-is-repository={git.gitSummary.isRepository}/>
        <button data-testid='refresh' onClick={git.onRefreshGit}>Refresh</button><button data-testid='review' onClick={()=>git.onOpenGitReview?.('unstaged')}>Review</button>
        <ConversationStatusPanel {...scope} {...git} summaryPanelVariantOverride={variant} onVariantChange={setVariant}/>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<StoreProvider broadcastService={{onMessage:()=>({dispose:()=>{}}),send:async()=>{}}}><TabStoreProvider><ServiceProvider services={services}><PlatformProvider platform={{isWeb:true}}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><Fixture/></TooltipProvider></ZCodeIntlProvider></PlatformProvider></ServiceProvider></TabStoreProvider></StoreProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${name}.html`, { waitUntil: "domcontentloaded" });
  const branch = (value) =>
    page.waitForFunction(
      (value) => document.querySelector('[data-testid="facts"]')?.dataset.branch === value,
      value,
    );
  await branch("local:/fixture/b");
  await page.getByRole("button", { name: "展开状态", exact: true }).waitFor();
  assert.match(
    await page.getByRole("button", { name: "展开状态", exact: true }).innerText(),
    /更改\s*\+24\s*-5/,
  );
  await page.screenshot({ path: join(artifacts, "mini.png"), animations: "disabled" });
  await page.getByRole("button", { name: "展开状态", exact: true }).click();
  const reviewControl = page.getByRole("button", { name: /^更改\s*\+24\s*-5$/ });
  await reviewControl.waitFor();
  assert.equal(await reviewControl.isEnabled(), true);
  await reviewControl.click();
  await page.waitForFunction(() => window.__git.reviews.length === 1);
  assert.equal(
    await page.evaluate(() => window.__git.reviews[0].scope.workspacePath),
    "/fixture/b",
  );
  await page.screenshot({ path: join(artifacts, "expanded.png"), animations: "disabled" });
  await page.evaluate(() => {
    window.__git.reviews.length = 0;
  });
  console.log("PASS: real mini badge expands into Git controls");

  // Navigation must finish before review opens, and the callback must capture the new scope.
  await page.evaluate(() => {
    window.__git.navigate({ workspacePath: "/fixture/a" });
    window.__git.setReady(false);
    window.__git.review({ workspacePath: "/fixture/b" }, "staged");
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__git.reviews.length), 0);
  await page.evaluate(() => window.__git.setReady(true));
  await page.waitForFunction(() => window.__git.reviews.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__git.reviews[0]), {
    scope: {
      workspacePath: "/fixture/b",
      workspaceIdentity: undefined,
      remoteSessionId: undefined,
    },
    sourceId: "staged",
  });
  // Leaving a disconnected review target cancels its pending request.
  await page.evaluate(() => {
    window.__git.setReady(false);
    window.__git.review(window.__git.remoteScope, "unstaged");
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__git.navigate({ workspacePath: "/fixture/a" }));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.__git.navigate(window.__git.remoteScope);
    window.__git.setReady(true);
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__git.reviews.length), 1);
  console.log(
    "PASS: scoped review waits for readiness and cancels when navigation leaves its target",
  );
  await page.evaluate(() => {
    window.__git.setReady(false);
    window.__git.review({ workspacePath: "/fixture/a" }, "staged");
    window.__git.review({ workspacePath: "/fixture/b" }, "unstaged");
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__git.setReady(true));
  await page.waitForFunction(() => window.__git.reviews.length === 2);
  assert.equal(
    await page.evaluate(() => window.__git.reviews.at(-1).scope.workspacePath),
    "/fixture/b",
  );
  assert.equal(await page.evaluate(() => window.__git.reviews.at(-1).sourceId), "unstaged");
  await page.evaluate(() => {
    window.__git.navigate({ ...window.__git.remoteScope, remoteSessionId: "current-attachment" });
    window.__git.review(
      { ...window.__git.remoteScope, remoteSessionId: "stale-attachment" },
      "unstaged",
    );
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.__git.current.remoteSessionId),
    "current-attachment",
  );
  assert.equal(await page.evaluate(() => window.__git.reviews.length), 2);
  await page.evaluate(() => {
    const target = { workspacePath: "/fixture/unavailable" };
    window.__git.markReadOnly(target);
    window.__git.review(target, "unstaged");
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.__git.current.remoteSessionId),
    "current-attachment",
  );
  assert.equal(await page.evaluate(() => window.__git.reviews.length), 2);
  await page.evaluate(() => {
    window.__git.setReady(false);
    window.__git.review(window.__git.remoteScope, "unstaged");
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__git.setReady(true));
  await page.waitForFunction(() => window.__git.reviews.length === 3);
  assert.equal(
    await page.evaluate(() => window.__git.reviews.at(-1).scope.remoteSessionId),
    "current-attachment",
  );
  console.log(
    "PASS: latest review wins; read-only and stale attachments are denied; identity-only requests resume",
  );

  const beforeDisable = await page.evaluate(() => window.__git.calls.length);
  await page.evaluate(() => window.__git.setEnabled(false));
  await branch("");
  await page.getByTestId("refresh").click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__git.calls.length), beforeDisable);
  await page.evaluate(() => window.__git.setEnabled(true));
  await branch("local:/fixture/b");
  console.log("PASS: Shell-owned Git projection disables duplicate pane reads");

  for (const mode of ["clean", "non-repository", "error"]) {
    await page.evaluate((mode) => {
      window.__git.setMode(mode);
      document.querySelector('[data-testid="refresh"]').click();
    }, mode);
    if (mode === "clean")
      await page.waitForFunction(
        () => document.querySelector('[data-testid="facts"]')?.dataset.added === "0",
      );
    else if (mode === "non-repository")
      await page.waitForFunction(
        () => document.querySelector('[data-testid="facts"]')?.dataset.isRepository === "false",
      );
    else await branch("");
    await page.waitForFunction(() => !document.querySelector('[data-testid="chat-summary-panel"]'));
  }
  console.log("PASS: clean/non-repository/failed reads hide the badge");

  await page.evaluate(() => {
    window.__git.setMode("slow");
    window.__git.setScope({ workspacePath: "/fixture/slow" });
  });
  await page.waitForFunction(() =>
    window.__git.calls.some((call) => call.workspacePath === "/fixture/slow"),
  );
  await page.evaluate(() => {
    window.__git.setMode("dirty");
    window.__git.setScope({ workspacePath: "/fixture/b" });
  });
  await branch("local:/fixture/b");
  await page.evaluate(() => window.__git.resolveSlow());
  await page.waitForTimeout(100);
  assert.equal(await page.getByTestId("facts").getAttribute("data-branch"), "local:/fixture/b");
  // Same path, different remote identity: disconnected scope cannot fall back to local Git.
  const localCount = await page.evaluate(
    () => window.__git.calls.filter((call) => call.host === "local").length,
  );
  await page.evaluate(() => window.__git.setScope(window.__git.remoteScope));
  await branch("");
  assert.equal(
    await page.evaluate(() => window.__git.calls.filter((call) => call.host === "local").length),
    localCount,
  );
  await page.evaluate(() => window.__git.connect());
  await branch("remote:/fixture/b");
  assert.equal(await page.getByTestId("facts").getAttribute("data-added"), "44");
  await page.evaluate(() => window.__git.disconnect());
  await branch("");
  console.log(
    "PASS: stale results are discarded; same-path remote Git uses its attachment and hides on disconnect",
  );
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error("Page errors:", errors);
  await page?.screenshot({ path: join(artifacts, "failure.png") });
  console.error("Screenshots:", artifacts);
  throw error;
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
