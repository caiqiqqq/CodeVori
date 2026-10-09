// Synthetic Hosts only. No real forge credentials, repositories or writes are used.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  assertIssueDraftAndAttributes,
  assertResponsiveIssueCreation,
  assertIssueCatalogScopeAndGitlab,
  assertIssueSettingsDraft,
} from "./repositoryIssueAssertions.mjs";
import { assertRepositoryListLabelColors } from "./repositoryListLabelAssertions.mjs";
import * as repositoryTask from "./repositoryTaskCreationAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__repository-panel-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-repository-ui-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepositoryPanel} from '../../../ui/src/repository-panel/RepositoryPanel.tsx';
    import {VersionControlSection} from '../../../ui/src/settings/VersionControlSection.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider,useTabStore} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import {consumeInitialSettingsSection} from '../../../ui/src/lib/settingsNavigation.ts';
    ${repositoryTask.importsFixture}
    import '../../../ui/src/styles.css';
    const state:any={calls:[],pending:[],status:'ready',delayList:false,delayWrite:false,delayDiscovery:false,failWrite:false,remote:false,accountDiscovery:false};
    window.__forge=state;
    const clone=(v:any)=>JSON.parse(JSON.stringify(v));
    const hosts:any={};
    const snapshots:any={};
    const label={key:'bug',name:'bug',color:'#d73a4a'};
    const baseItem=(host:string,request:any)=>({number:7,kind:request.kind,title:host+' '+(request.remoteName||'origin')+' '+request.kind+' '+(request.page||1),body:'## Synthetic description\\n\\nA reproducible issue.',state:'open',draft:false,author:{username:'tester',avatarUrl:null},url:'https://forge.example.invalid/team/project/issues/7',createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',labels:[label,{key:'优化',name:'优化',color:'#eee600'}],commentCount:1});
    const comment={id:'c1',body:'Synthetic comment',author:{username:'reviewer',avatarUrl:null},createdAt:'2026-10-01T00:00:00Z',url:null};
    const commentRows:any={A:[comment],B:[comment]};
    const states:any={A:'open',B:'open'};
    const finish=()=>state.pending.shift()?.();state.finish=finish;
    for(const host of ['A','B']) {
      snapshots[host]={customPath:null,accounts:[{id:crypto.randomUUID(),provider:'github',serverUrl:'https://github.com',username:'github-tester',scopes:[],avatarUrl:null,isDefault:true,createdAt:'2026-01-01T00:00:00Z'}]};
      hosts[host]={gitService:{
      async getVersionControlSettings(){return clone(snapshots[host])},
      async detectGit(){return {installed:true,path:'/synthetic/git',version:'git version 2.50.0'}},
      async addGitAccount(r:any){state.calls.push({host,op:'add-account',provider:r.provider,serverUrl:r.serverUrl});if(r.secret==='invalid')throw new Error('VERSION_CONTROL_authentication');snapshots[host].accounts.push({id:crypto.randomUUID(),provider:r.provider,serverUrl:r.serverUrl,username:r.provider+'-tester',scopes:[],avatarUrl:null,isDefault:false,createdAt:'2026-01-01T00:00:00Z'});return clone(snapshots[host])},
      async getForgeRepository(r:any){state.calls.push({host,op:'discover',...r});const remoteName=r.remoteName||'origin';const matched=snapshots[host].accounts.find((a:any)=>a.provider==='gitlab'&&a.serverUrl==='https://forge.example.invalid');const status=state.accountDiscovery?(matched?'ready':snapshots[host].accounts.length?'account-mismatch':'unsupported'):state.status;const provider=state.accountDiscovery?(matched?.provider??null):(state.provider||'github');const result={status,remoteNames:['origin','private'],remoteName,host:'forge.example.invalid',provider,repository:status==='ready'?{key:host+remoteName,name:'team/'+host.toLowerCase(),url:'https://forge.example.invalid/team/'+host,provider,accountId:matched?.id??host,accountUsername:'tester'}:null};if(state.delayDiscovery){state.delayDiscovery=false;return new Promise(resolve=>state.pending.push(()=>resolve(clone(result))))}return result},
      async listForgeItems(r:any){state.calls.push({host,op:'list',...r});const result={items:[{...baseItem(host,r),state:states[host]}],page:r.page,pageSize:20,hasMore:r.page===1,total:21,reachableTotal:21,incomplete:false};if(state.delayList){state.delayList=false;return new Promise(resolve=>state.pending.push(()=>resolve(clone(result))))}return clone(result)},
      async listForgeLabels(){return [label]},
      async getForgeIssueOptions(r:any){state.calls.push({host,op:'options',...r});const result={labels:{items:[label,{key:'enhancement',name:'enhancement',color:'#a2eeef'}],error:null},assignees:{items:[{key:'alice',username:'alice',avatarUrl:null}],error:state.failOptions?'FORGE_FORBIDDEN':null},milestones:{items:[{key:'3',title:'Release'}],error:null}};if(state.delayOptions){state.delayOptions=false;return new Promise(resolve=>state.pending.push(()=>resolve(clone(result))))}return clone(result)},
      async getForgeItem(r:any){state.calls.push({host,op:'detail',...r});if(state.failDetail){state.failDetail=false;throw new Error('FORGE_NETWORK')}const result={...baseItem(host,r),body:'## Synthetic description\\n\\nA reproducible issue.\\nFull detail only.',state:states[host],change:r.kind==='pull-request'?{headSha:'a'.repeat(40),headBranch:'feature',baseBranch:'main',mergeable:true,mergeMethods:['merge','squash'],mergeOptionsError:null,checks:[{id:'check',name:'tests',state:'success',url:null}],checksError:null}:null};if(state.delayDetail){state.delayDetail=false;return new Promise(resolve=>state.pending.push(()=>resolve(result)))}return result},
      async getForgeItemExtras(){return {}},
      async listForgeComments(r:any){return {items:clone(commentRows[host]),page:r.page,pageSize:30,hasMore:false,total:commentRows[host].length}},
      async listForgeFiles(r:any){return {items:[{path:'src/very-long-project-directory/a-very-long-filename-with-many-words.ts',previousPath:null,status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\\n-old\\n+new',truncated:false}],page:r.page,pageSize:30,hasMore:false,total:1}},
      async createForgeIssue(r:any){state.calls.push({host,op:'create',...r});if(state.failWrite){state.failWrite=false;throw new Error('FORGE_FORBIDDEN')}return {...baseItem(host,{kind:'issue',...r}),number:99,title:r.title,body:r.body}},
      async createForgeComment(r:any){state.calls.push({host,op:'comment',...r});if(state.failWrite){state.failWrite=false;throw new Error('FORGE_FORBIDDEN')}if(state.delayWrite){state.delayWrite=false;await new Promise(resolve=>state.pending.push(resolve))}commentRows[host].push({...comment,id:'c'+commentRows[host].length,body:r.body})},
      async setForgeItemState(r:any){state.calls.push({host,op:'state',...r});states[host]=r.state},
      async mergeForgePullRequest(r:any){state.calls.push({host,op:'merge',...r});states[host]='merged'},
    }};}
    ${repositoryTask.repositoryTaskServicesFixture}
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    const platform:any={openExternal:(url:string)=>state.calls.push({op:'external',url})};
    function Fixture(){const [host,setHost]=useState('A');const [version,setVersion]=useState(0);const settingsVisible=useTabStore(s=>s.activeTabId==='__settings__');const openSettings=useTabStore(s=>s.openSettingsTab);const closeTab=useTabStore(s=>s.closeTab);state.switchHost=setHost;state.remount=()=>setVersion(v=>v+1);state.settings=consumeInitialSettingsSection;state.openSettings=openSettings;
      return <ServiceProvider services={hosts[host]}><div className='h-dvh bg-background text-foreground'><div hidden={settingsVisible} className='h-full'><RepositoryPanel key={version} active={!settingsVisible} workspacePath={state.taskRemote?'/synthetic/A':'/synthetic/'+host} workspaceIdentity={state.remote?'synthetic-disconnected-workspace':state.taskRemote?'synthetic-task-identity':undefined} remoteSessionId={state.taskRemote?'task-remote':undefined} theme='zai-light' onCreateTask={(request:any)=>state.calls.push({host,op:'agent',...request})}/></div>{settingsVisible?<div className='h-full overflow-auto p-4'><button onClick={()=>closeTab('__settings__')}>返回仓库</button><VersionControlSection/></div>:null}</div></ServiceProvider>}
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
  const errors = repositoryTask.observeRepositoryErrors(page);
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  const panel = page.getByTestId("repository-panel");
  const row = () => panel.getByTestId("repository-item-row").first();
  const countCalls = (...ops) =>
    page.evaluate(
      (ops) => window.__forge.calls.filter((call) => ops.includes(call.op)).length,
      ops,
    );
  const assertListLabelColors = () => assertRepositoryListLabelColors(row);
  await row().waitFor();
  await repositoryTask.exerciseRepositoryTaskCreation(page, panel, artifacts);
  await assertListLabelColors();
  assert.match(await row().innerText(), /A origin issue 1/);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="repository-item-row"]')?.textContent?.includes("issue 2"),
  );
  await assertListLabelColors();
  await panel.getByRole("button", { name: "上一页", exact: true }).click();
  const search = panel.getByRole("textbox", { name: "搜索标题和描述" });
  await search.fill("synthetic search");
  await search.press("Enter");
  await page.waitForFunction(() =>
    window.__forge.calls.some(
      (c) => c.op === "list" && c.search === "synthetic search" && c.page === 1,
    ),
  );
  await panel.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "bug", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    window.__forge.calls.some((c) => c.op === "list" && c.labels.includes("bug")),
  );
  await panel.getByRole("combobox", { name: "状态", exact: true }).click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  await page.waitForFunction(() =>
    window.__forge.calls.some((c) => c.op === "list" && c.state === "all" && c.page === 1),
  );
  await panel.getByRole("combobox", { name: "排序", exact: true }).click();
  await page.getByRole("option", { name: "最近更新", exact: true }).click();
  await page.waitForFunction(() =>
    window.__forge.calls.some((c) => c.op === "list" && c.sort === "updated" && c.page === 1),
  );
  await row().click();
  const detail = page.getByTestId("repository-item-detail");
  await detail.getByText("Synthetic description", { exact: true }).waitFor();
  const input = detail.getByRole("textbox", { name: "评论" });
  await input.fill("Test comment");
  await page.evaluate(() => {
    window.__forge.failWrite = true;
  });
  await detail.getByRole("button", { name: "发表评论", exact: true }).click();
  await detail.getByRole("alert").waitFor();
  assert.equal(await input.inputValue(), "Test comment");
  await detail.getByRole("button", { name: "发表评论", exact: true }).click();
  await detail.getByText("Test comment", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");
  await detail.getByRole("button", { name: "关闭议题", exact: true }).click();
  const confirm = page.getByTestId("repository-confirm");
  assert.equal(await countCalls("state"), 0);
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await detail.getByRole("button", { name: "关闭议题", exact: true }).click();
  await confirm.getByRole("button", { name: "确认关闭", exact: true }).click();
  await detail.getByRole("button", { name: "重新打开", exact: true }).waitFor();
  await detail.getByRole("button", { name: "重新打开", exact: true }).click();
  await confirm.getByRole("button", { name: "确认重开", exact: true }).click();
  await detail.getByRole("button", { name: "交给智能体处理", exact: true }).click();
  const handoff = await page.evaluate(() => window.__forge.calls.find((c) => c.op === "agent"));
  assert.equal(handoff.targetWorkspace.workspacePath, "/synthetic/A");
  assert.match(handoff.initialPrompt, /外部仓库/);
  assert.equal(handoff.autoSend, undefined);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await panel.getByRole("tab", { name: "拉取请求", exact: true }).click();
  await assertListLabelColors();
  await row().click();
  await detail.getByRole("tab", { name: "文件变更", exact: true }).click();
  await detail
    .getByText("src/very-long-project-directory/a-very-long-filename-with-many-words.ts", {
      exact: true,
    })
    .click();
  await detail.locator("[data-lightweight-diff-preview]").waitFor();
  await detail.getByRole("tab", { name: "检查项", exact: true }).click();
  await detail.getByText("tests", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "合并", exact: true }).click();
  assert.equal(await countCalls("merge"), 0);
  await confirm.getByRole("button", { name: "确认合并", exact: true }).click();
  await detail.getByText("已合并", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  const create = page.getByTestId("repository-new-issue");
  await assertIssueDraftAndAttributes({ page, create, countCalls });
  await detail.waitFor();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.evaluate(() => {
    window.__forge.delayList = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await page.evaluate(() => window.__forge.switchHost("B"));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-item-row"]')
      ?.textContent?.includes("B origin"),
  );
  await page.evaluate(() => window.__forge.finish());
  assert.match(await row().innerText(), /B origin/);
  await panel.getByRole("combobox", { name: "远端仓库", exact: true }).click();
  await page.getByRole("option", { name: "private", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-item-row"]')
      ?.textContent?.includes("B private"),
  );
  await row().click();
  await detail.getByText("Synthetic description", { exact: true }).waitFor();
  await detail.getByRole("textbox", { name: "评论" }).fill("Delayed comment");
  await page.evaluate(() => {
    window.__forge.delayWrite = true;
  });
  await detail.getByRole("button", { name: "发表评论", exact: true }).click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  const delayedCount = await page.evaluate(
    () =>
      window.__forge.calls.filter((c) => c.op === "comment" && c.body === "Delayed comment").length,
  );
  assert.equal(delayedCount, 1);
  await page.evaluate(() => window.__forge.switchHost("A"));
  await detail.waitFor({ state: "detached" });
  await row().waitFor();
  await row().click();
  await detail.getByRole("textbox", { name: "评论" }).fill("New Host draft");
  await page.evaluate(() => window.__forge.finish());
  assert.equal(await detail.getByRole("textbox", { name: "评论" }).inputValue(), "New Host draft");
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await detail.waitFor({ state: "detached" });
  const settleVisuals = async () => {
    await page.mouse.move(1, 849);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  };
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await settleVisuals();
      await assertListLabelColors();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        theme + "/" + width + " list overflow",
      );
      await page.screenshot({ path: join(artifacts, theme + "-" + width + "-list.png") });
      await row().click();
      await detail.getByText("Synthetic description", { exact: true }).waitFor();
      await settleVisuals();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        theme + "/" + width + " detail overflow",
      );
      await page.screenshot({ path: join(artifacts, theme + "-" + width + "-detail.png") });
      await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
      await detail.waitFor({ state: "detached" });
      await assertResponsiveIssueCreation({
        page,
        panel,
        create,
        settleVisuals,
        artifacts,
        theme,
        width,
      });
    }
  }
  await assertIssueCatalogScopeAndGitlab({ page, panel, create, detail, row, settleVisuals });
  await page.evaluate(() => {
    window.__forge.provider = "gitea";
    window.__forge.remount();
  });
  await row().waitFor();
  await panel.getByRole("combobox", { name: "排序", exact: true }).waitFor({ state: "detached" });
  assert.equal(await panel.getByRole("combobox", { name: "排序", exact: true }).count(), 0);
  await page.evaluate(() => {
    window.__forge.status = "missing-account";
    window.__forge.remount();
  });
  await panel.getByRole("button", { name: "添加账号", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__forge.settings()), "versionControl");
  await page.getByTestId("version-control-settings").waitFor();
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await panel
    .getByText("尚未为 forge.example.invalid 配置托管平台账号。", { exact: true })
    .waitFor();

  await page.evaluate(() => {
    window.__forge.accountDiscovery = true;
    window.__forge.remount();
  });
  const mismatch = panel.getByText(/已添加账号，但没有可用于 forge\.example\.invalid/);
  await mismatch.waitFor();
  for (const width of [1120, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await settleVisuals();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "account mismatch/" + width + " overflow",
    );
    await page.screenshot({ path: join(artifacts, "account-mismatch-" + width + ".png") });
  }
  await page.setViewportSize({ width: 1120, height: 850 });
  await panel.getByRole("button", { name: "添加账号", exact: true }).click();
  const settings = page.getByTestId("version-control-settings");
  await settings.getByTestId("vc-provider-github").getByTestId("vc-account").waitFor();
  const discoveryCount = await countCalls("discover");
  await settings.getByRole("button", { name: "添加账号 GitLab", exact: true }).click();
  const accountDialog = page.getByRole("dialog");
  await accountDialog.locator("#vc-account-server").fill("https://forge.example.invalid");
  await accountDialog.locator("#vc-account-secret").fill("invalid");
  await accountDialog.getByRole("button", { name: "验证并添加", exact: true }).click();
  await accountDialog.getByRole("alert").waitFor();
  assert.equal(
    await settings.getByTestId("vc-provider-gitlab").getByTestId("vc-account").count(),
    0,
  );
  await accountDialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await mismatch.waitFor();
  assert.equal(await countCalls("discover"), discoveryCount + 1);
  await panel.getByRole("button", { name: "添加账号", exact: true }).click();
  await settings.getByTestId("vc-provider-github").getByTestId("vc-account").waitFor();
  const recoveryDiscoveryCount = await countCalls("discover");
  await settings.getByRole("button", { name: "添加账号 GitLab", exact: true }).click();
  await accountDialog.locator("#vc-account-server").fill("https://forge.example.invalid");
  await accountDialog.locator("#vc-account-secret").fill("synthetic-gitlab-token");
  await accountDialog.getByRole("button", { name: "验证并添加", exact: true }).click();
  await accountDialog.waitFor({ state: "detached" });
  await settings.getByTestId("vc-provider-gitlab").getByTestId("vc-account").waitFor();
  await settings.getByTestId("vc-provider-github").getByTestId("vc-default").waitFor();
  assert.equal(
    await countCalls("discover"),
    recoveryDiscoveryCount,
    "the covered workspace must not start account discovery",
  );
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await row().waitFor();
  assert.equal(await mismatch.count(), 0);
  assert.match(await panel.innerText(), /GitLab/);
  assert.equal(
    await countCalls("discover"),
    recoveryDiscoveryCount + 1,
    "returning from settings must rediscover without a remount or manual refresh",
  );

  await row().click();
  await detail.getByText("Synthetic description", { exact: true }).waitFor();
  await input.fill("Retained comment draft");
  await page.evaluate(() => window.__forge.openSettings());
  await settings.waitFor();
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await detail.getByText("Synthetic description", { exact: true }).waitFor();
  assert.equal(await input.inputValue(), "Retained comment draft");
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();

  await assertIssueSettingsDraft({ page, panel, create, settings, countCalls });

  // 设置覆盖时取消旧发现代次，防止迟到的账号不匹配结果覆盖返回后的新快照。
  await page.evaluate(() => {
    window.__forge.accountDiscovery = false;
    window.__forge.status = "account-mismatch";
    window.__forge.delayDiscovery = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await page.evaluate(() => window.__forge.openSettings());
  await settings.waitFor();
  await page.evaluate(() => {
    window.__forge.status = "ready";
  });
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await row().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="repository-panel"]')?.getAttribute("aria-busy") ===
      "false",
  );
  await page.evaluate(() => window.__forge.finish());
  await settleVisuals();
  assert.equal(await mismatch.count(), 0);
  assert.match(await row().innerText(), /A origin/);

  const localCalls = await page.evaluate(() => window.__forge.calls.length);
  await page.evaluate(() => {
    window.__forge.remote = true;
    window.__forge.remount();
  });
  await panel.getByRole("alert").waitFor();
  assert.equal(await row().count(), 0);
  assert.equal(await panel.getByRole("button", { name: "添加账号", exact: true }).count(), 0);
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="repository-panel"]')?.getAttribute("aria-busy") ===
      "false",
  );
  assert.equal(await page.evaluate(() => window.__forge.calls.length), localCalls);
  assert.deepEqual(errors, []);
  process.stdout.write(
    `PASS: scoped todo task creation, duplicate admission, read/save failures, API/ACP preferences, remote scope, stale read/save isolation; repository tabs, filters, pages, details, comments, confirmations, creation, agent draft, account mismatch and settings recovery, Host/discovery races, disconnected remote isolation and responsive themes. Screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
