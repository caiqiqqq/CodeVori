// Real board and task editor with synthetic Host writes; no Agent process is started.
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";

const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-create-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
let browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  const additions = `
const modelView={revision:1,preferredSelection:{providerId:'api',modelId:'TestModel',options:{reasoningLevel:'high'}},providers:[{providerId:'api',providerName:'Test API',config:{api:{type:'openai-chat-completions'}},models:[{modelId:'TestModel',config:{optionSpecs:{reasoningLevel:{values:['low','high']}}}}]}]};
services.clientConfigService={getSnapshot:async()=>({pluginStoreOrder:null})};
const syntheticAgent={onDynamicConversationFrame:()=>()=>({dispose(){}}),onAgentRuntimeRestarted:()=>({dispose(){}})};
services.zcodeAgentService=syntheticAgent;
services.systemService.info=async()=>({platform:'darwin',homedir:'/fixture'});
services.modelSelectionService={getView:async input=>({...modelView,effectiveSelection:input?.selection??modelView.preferredSelection}),onDidChange:()=>({dispose(){}})};
services.settingService={get:async()=>({worktreeRootDirectory:'/fixture/worktrees'})};
services.acpService.listAvailableAgents=async()=>[];
services.acpService.listAgentConfigs=async()=>[];
services.acpService.onDynamicAgentConfigsChanged=()=>()=>({dispose(){}});
const branchByPath=new Map();
const originalGitRefresh=services.gitService.refresh;
services.gitService.refresh=async input=>{const result=await originalGitRefresh(input);result.summary.branchName=branchByPath.get(input.workspacePath)??'main';return result};
services.gitService.getLocalBranches=async({workspacePath})=>({headRefType:'branch',currentBranchName:branchByPath.get(workspacePath)??'main',branches:['main','feature/board-create'].map(name=>({name,isCurrent:name===(branchByPath.get(workspacePath)??'main'),upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}))});
services.gitService.switchBranch=async({workspacePath,targetBranchName})=>{commands.push({kind:'branch-switch',workspacePath,targetBranchName});if(window.__board.holdBranchSwitch)await new Promise(resolve=>window.__board.releaseBranchSwitch=resolve);branchByPath.set(workspacePath,targetBranchName);const git=await services.gitService.refresh({workspacePath});return{ok:true,action:'switch',branchName:targetBranchName,didChange:true,created:false,summary:git.summary,issues:[]}};
services.gitService.createAutomaticWorktree=async input=>{commands.push({kind:'worktree-create',...input});if(window.__board.failWorktreeCreate){window.__board.failWorktreeCreate=false;return{ok:false,branchName:null,worktreePath:'',didCreate:false,issues:[{code:'target-path-not-empty',message:'Synthetic worktree conflict'}]}}return{ok:true,branchName:'worktree/board-create',worktreePath:'/fixture/worktrees/board-create',didCreate:true,issues:[]}};
for(const tab of tabs.slice(0,2)){const remote=useRemoteWorkspaceSessionStore.getState().sessionsById[tab.remoteSessionId];if(!remote)continue;Object.assign(remote.services,{zcodeAgentService:syntheticAgent,clientConfigService:services.clientConfigService,modelSelectionService:services.modelSelectionService});remote.services.systemService.info=async()=>({platform:'linux',homedir:'/fixture'});Object.assign(remote.services.acpService,{listAvailableAgents:async()=>[],listAgentConfigs:async()=>[],onDynamicAgentConfigsChanged:()=>()=>({dispose(){}})});const remoteGit=remote.services.gitService;remoteGit.getLocalBranches=async()=>({headRefType:'branch',currentBranchName:'main',branches:['main','feature/board-create'].map(name=>({name,isCurrent:name==='main',upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}))});remoteGit.switchBranch=async({workspacePath,targetBranchName})=>{commands.push({kind:'remote-branch-switch',host:tab.remoteSessionId,workspacePath,targetBranchName});const summary=(await remoteGit.refresh({workspacePath})).summary;return{ok:true,action:'switch',branchName:targetBranchName,didChange:true,created:false,summary:{...summary,branchName:targetBranchName},issues:[]}};}
services.workTaskService.create=async input=>{if(window.__board.failCreate){window.__board.failCreate=false;throw Error('Synthetic create failed')}const task={...input,id:'created-'+workRows.length,status:'todo',archived:false,stopPending:false,runSeq:0,runText:input.prompt,createdAt:Date.now(),updatedAt:Date.now()};commands.push({kind:'work-task-create',...input});workRows.push(task);for(const listener of workListeners)listener();return {...task}};
`;
  await writeFile(
    moduleFile,
    agentBoardFixture.replace("function Fixture(){", additions + "\nfunction Fixture(){"),
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.stack));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.evaluate(() => {
    const store = window.__board.store.getState();
    store.setTracking({
      mode: "custom",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [],
      excludedItems: [],
    });
    store.selectProject("/fixture/project-3");
    store.setAgent("other-agent");
    store.setSearch("hidden");
    store.setView("failed");
  });
  await page.getByTestId("agent-board-new-work-task").click();
  const editor = page.getByTestId("work-task-editor");
  await editor.waitFor();
  await editor.getByTestId("work-task-prompt").fill("Created from Agent board");
  await page.evaluate(() => (window.__board.failCreate = true));
  await editor.getByTestId("work-task-save").click();
  await editor.getByText("Synthetic create failed", { exact: true }).waitFor();
  assert.equal(
    await editor.getByTestId("work-task-prompt").innerText(),
    "Created from Agent board",
  );
  assert.equal(await page.evaluate(() => window.__board.workRows.length), 0);
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Created from Agent board", exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const { project, category } = window.__board.store.getState();
      return { project, category };
    }),
    { project: "/fixture/project-3", category: "all" },
  );
  await page.getByRole("button", { name: "Project 3", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__board.workRows[0].status), "todo");
  assert.equal(
    await page.evaluate(
      () => window.__board.commands.filter((row) => row.kind === "work-task-create").length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.__board.store.getState().tracking.includedItems.length),
    1,
  );
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  const sessionEditor = page.getByTestId("agent-board-session-editor");
  await sessionEditor.waitFor();
  await sessionEditor.getByTestId("agent-board-session-project").waitFor();
  await sessionEditor.getByTestId("agent-board-session-project").click();
  await page.getByRole("option", { name: "Project 3", exact: true }).click();
  await sessionEditor.getByText("/fixture/project-3", { exact: true }).waitFor();
  const sessionInput = sessionEditor.getByTestId("v4-composer-input");
  await sessionInput.fill("Create from selected branch");
  assert.equal(await sessionInput.getAttribute("contenteditable"), "true");
  await page.evaluate(() => (window.__board.holdBranchSwitch = true));
  await sessionEditor.getByRole("button", { name: "切换 Git 分支" }).click();
  await page.getByText("feature/board-create", { exact: true }).click();
  await page.waitForFunction(() =>
    window.__board.commands.some(
      (row) =>
        row.kind === "branch-switch" &&
        row.workspacePath === "/fixture/project-3" &&
        row.targetBranchName === "feature/board-create",
    ),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="v4-composer-input"]')
        ?.getAttribute("contenteditable") === "false",
  );
  assert.equal(await sessionInput.innerText(), "Create from selected branch");
  await page.evaluate(() => window.__board.releaseBranchSwitch());
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="v4-composer-input"]')
        ?.getAttribute("contenteditable") === "true",
  );
  await sessionEditor.getByText("feature/board-create", { exact: true }).waitFor();
  await page.locator('[data-slot="popover-content"]').waitFor({ state: "detached" });
  await sessionEditor.getByTestId("v4-composer-input").waitFor();
  if (process.env.ZCODE_BOARD_SCREENSHOT)
    await page.screenshot({ path: process.env.ZCODE_BOARD_SCREENSHOT, fullPage: true });
  if (process.env.ZCODE_BOARD_MOBILE_SCREENSHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await sessionEditor.getByTestId("v4-composer-input").isVisible());
    await page.screenshot({ path: process.env.ZCODE_BOARD_MOBILE_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 1500, height: 950 });
  }
  assert.equal(await page.getByTestId("navigation").innerText(), "");
  assert.equal(
    await page.evaluate(() => window.__board.store.getState().tracking.projects.length),
    0,
  );
  await sessionEditor.getByRole("button", { name: "取消", exact: true }).click();
  await sessionEditor.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.__board.store.getState().tracking.projects.length),
    0,
  );
  await page.getByRole("heading", { name: "Created from Agent board", exact: true }).waitFor();
  await page.getByTestId("agent-board-new-session").click();
  const remoteEditor = page.getByTestId("agent-board-session-editor");
  await remoteEditor.getByTestId("agent-board-session-project").click();
  await page.getByRole("option", { name: "Same project", exact: true }).click();
  assert.equal(await remoteEditor.getByTestId("agent-board-session-worktree").count(), 0);
  await remoteEditor.getByRole("button", { name: "切换 Git 分支" }).click();
  await page.getByText("feature/board-create", { exact: true }).click();
  await page.waitForFunction(() =>
    window.__board.commands.some(
      (row) =>
        row.kind === "remote-branch-switch" &&
        row.host === "host-0" &&
        row.workspacePath === "/same",
    ),
  );
  await remoteEditor.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.getByTestId("navigation").innerText(), "");
  await page.getByTestId("agent-board-new-session").click();
  const worktreeEditor = page.getByTestId("agent-board-session-editor");
  await worktreeEditor.getByTestId("agent-board-session-project").click();
  await page.getByRole("option", { name: "Project 3", exact: true }).click();
  const createWorktree = worktreeEditor.getByTestId("agent-board-session-worktree");
  await createWorktree.waitFor();
  assert.equal(await createWorktree.getAttribute("data-state"), "unchecked");
  await createWorktree.click();
  assert.equal(await createWorktree.getAttribute("data-state"), "checked");
  await worktreeEditor.getByRole("button", { name: "切换 Git 分支" }).click();
  await page.locator('[data-slot="popover-content"]').getByText("main", { exact: true }).click();
  await worktreeEditor.getByText("新建工作树 · main", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.__board.commands.filter((row) => row.kind === "worktree-create").length,
    ),
    0,
  );
  await worktreeEditor.getByTestId("v4-composer-input").fill("Create session in a worktree");
  const branchSwitchCount = await page.evaluate(
    () => window.__board.commands.filter((row) => row.kind === "branch-switch").length,
  );
  await page.evaluate(() => (window.__board.failWorktreeCreate = true));
  await worktreeEditor.getByTestId("v4-composer-send").click();
  await page.waitForFunction(
    () => window.__board.commands.filter((row) => row.kind === "worktree-create").length === 1,
  );
  assert.equal(await createWorktree.getAttribute("data-state"), "checked");
  assert.equal(
    await worktreeEditor.getByTestId("v4-composer-input").innerText(),
    "Create session in a worktree",
  );
  assert.equal(
    await page.evaluate(() =>
      window.__board.openTabs.some(
        (tab) =>
          tab.kind === "workspace" && tab.workspacePath === "/fixture/worktrees/board-create",
      ),
    ),
    false,
  );
  await worktreeEditor.getByTestId("v4-composer-send").click();
  await page.waitForFunction(() =>
    window.__board.commands.some(
      (row) =>
        row.kind === "worktree-create" &&
        row.workspacePath === "/fixture/project-3" &&
        row.sourceBranchName === "main",
    ),
  );
  await page.waitForFunction(() =>
    window.__board.openTabs.some(
      (tab) => tab.kind === "workspace" && tab.workspacePath === "/fixture/worktrees/board-create",
    ),
  );
  assert.equal(
    await worktreeEditor.getByTestId("v4-composer-input").innerText(),
    "Create session in a worktree",
  );
  assert.equal(
    await page.evaluate(
      () => window.__board.commands.filter((row) => row.kind === "branch-switch").length,
    ),
    branchSwitchCount,
  );
  assert.equal(
    await page.evaluate(
      () => window.__board.commands.filter((row) => row.kind === "worktree-create").length,
    ),
    2,
  );
  assert.equal(await page.getByTestId("navigation").innerText(), "");
  await worktreeEditor.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => {
    // Host 接受首发后，精确 ID 纳入自定义范围，原列表投影显示卡片。
    window.__board.store.getState().revealCreatedSession({
      kind: "native",
      key: JSON.stringify(["/fixture/project-3", "native", "fresh-conversation"]),
      projectKey: "/fixture/project-3",
    });
    window.__board.native.push({
      ...window.__board.native[3],
      taskId: "fresh-conversation",
      title: "New conversation on board",
      status: "running",
      liveStatus: "running",
      archived: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    window.__board.update(3, {});
  });
  await page.getByRole("heading", { name: "New conversation on board", exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const { project, category } = window.__board.store.getState();
      return { project, category };
    }),
    { project: "/fixture/project-3", category: "all" },
  );
  if (process.env.ZCODE_BOARD_CREATED_SCREENSHOT)
    await page.screenshot({ path: process.env.ZCODE_BOARD_CREATED_SCREENSHOT, fullPage: true });
  assert.deepEqual(
    await page.evaluate(() => window.__board.store.getState().tracking.projects),
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.getByTestId("agent-board-new-work-task").isVisible());
  assert.ok(await page.getByRole("button", { name: "新建会话", exact: true }).isVisible());
  await page.evaluate(() => window.__board.store.getState().selectProject(null));
  await page.getByRole("button", { name: "所有项目", exact: true }).waitFor();
  await page.getByTestId("agent-board-new-work-task").click();
  const allProjectsEditor = page.getByTestId("work-task-editor");
  await allProjectsEditor.getByTestId("work-task-prompt").fill("Keep all projects selected");
  await allProjectsEditor.getByTestId("work-task-save").click();
  await allProjectsEditor.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "所有项目", exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const { project, category } = window.__board.store.getState();
      return { project, category };
    }),
    { project: null, category: "all" },
  );
  assert.deepEqual(errors, []);
  console.log("PASS: board work task create/failure/reveal and inline session draft");
} catch (error) {
  console.error("Board page errors:", errors, error);
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
