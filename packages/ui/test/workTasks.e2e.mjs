// Synthetic Host commands only; no model requests, credentials or user repositories.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  assertWorkTaskBoardOnly,
  exerciseWorkTaskBoardResize,
  exerciseWorkTaskCompactRows,
} from "./workTaskBoardLayoutAssertions.mjs";
import {
  exerciseWorkTaskWorkbenchLayout,
  assertWorkTaskSessionTarget,
  remountWorkTaskPanel,
  exerciseWorkTaskConversationResize,
} from "./workTaskWorkbenchLayoutAssertions.mjs";
import {
  exerciseWorkTaskResponsiveLayout,
  captureWorkTaskLayoutFailure,
} from "./workTaskResponsiveAssertions.mjs";
import {
  exerciseWorkTaskSelection,
  exerciseWorkTaskProjectBoundary,
  exerciseWorkTaskProjectReadRace,
} from "./workTaskSelectionAssertions.mjs";
import {
  assertWorkTaskPendingChat,
  exerciseWorkTaskHomeRepositoryError,
} from "./workTaskChatPresentationAssertions.mjs";
import {
  exerciseWorkTaskAcpCreation,
  exerciseWorkTaskAgentConfigSelection,
  exerciseWorkTaskAgentConfigPersistence,
} from "./workTaskAgentConfigAssertions.mjs";
import { exerciseWorkTaskWorkspaceTools } from "./workTaskWorkspaceToolsAssertions.mjs";
import { workTaskPanelFixture } from "./workTaskPanelFixture.mjs";
import { workTaskPromptAssetsFixture } from "./workTaskPromptAssetsFixture.mjs";
import { routeWorkTaskConversationFixture } from "./workTaskConversationFixture.mjs";

import {
  workTaskScenarios,
  exerciseWorkTaskPromptAttachments,
  exerciseWorkTaskImageResources,
  exerciseWorkTaskPendingImages,
  exerciseWorkTaskEditRestart,
  exerciseWorkTaskExecutionPreferences,
  exerciseWorkTaskConversationStatus,
  exerciseWorkTaskConcurrentExecution,
  exerciseWorkTaskCompletion,
} from "./workTaskScenarios.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__work-tasks-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-work-tasks-ui-"));
let browser;
const errors = [];
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkTasksPanel} from '../../../ui/src/work-tasks/WorkTasksPanel.tsx';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {PlatformProvider} from '../../../ui/src/hooks/usePlatform.tsx';
    import {StoreProvider} from '../../../ui/src/store/StoreProvider.tsx';
    import {TabStoreProvider} from '../../../ui/src/store/TabStoreProvider.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {TooltipProvider} from '../../../ui/src/components/ui/tooltip.tsx';
    import toolIcon from '../../../ui/src/assets/provider-icons/logo-zai.svg';
    import '../../../ui/src/styles.css';
    window.__React=React;
    const state:any={calls:[],tasks:[],toolCalls:[],toolTarget:null,failSave:false,failStart:false,concurrency:2,delayList:false,pending:[],closed:[],deferPreparation:false};
    window.__tasks=state;
    const clone=(v:any)=>structuredClone(v);
    const listeners=new Set<()=>void>();
    const changed=()=>{for(const notify of listeners)notify()};state.changed=changed;
    const rows=(scope:any)=>state.tasks.filter((task:any)=>task.workspacePath===scope.workspacePath&&(scope.includeArchived||!task.archived));
    const modelView:any={revision:1,preferredSelection:{providerId:'api',modelId:'TestModel',options:{reasoningLevel:'high'}},providers:[{providerId:'api',providerName:'Test API',config:{api:{type:'openai-chat-completions'}},models:[{modelId:'TestModel',config:{optionSpecs:{reasoningLevel:{values:['low','high']}}}}]}]};
    state.catalog=[{agent:'codex',source:'host',modeState:null,configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:'codex-model',options:[{value:'codex-model',name:'CodexModel'}]},{id:'reasoning',name:'Reasoning',category:'thought_level',type:'select',currentValue:'high',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]},{id:'fast',name:'Fast',type:'boolean',currentValue:false}]},{agent:'claude',source:'host',configOptions:[],modeState:{currentModeId:'default',availableModes:[{id:'default',name:'Manual'},{id:'plan',name:'Plan'}]}}];
    state.agentListeners=new Set();state.pendingConfigs=[];state.publishConfig=()=>{for(const notify of state.agentListeners)notify()};state.finishConfig=()=>state.pendingConfigs.shift()?.();
    const get=(r:any)=>{const task=state.tasks.find((t:any)=>t.id===r.id&&t.workspacePath===r.workspacePath);if(!task)throw new Error('work-task.not-found');return task};
    const bind=(task:any)=>{task.status='running';task.session??={kind:task.execution.kind,id:'session-'+task.id}};
    const start=(task:any,feedback?:string)=>{task.status='preparing';task.failureReason=undefined;task.runSeq++;task.runText=feedback||task.prompt;task.updatedAt=Date.now();if(task.useWorktree===false){task.directBranch=task.sourceBranch;state.currentBranch=task.sourceBranch}else task.worktree??={rootPath:'/synthetic/trees',path:'/synthetic/trees/'+task.id+'/project',projectPath:task.workspacePath,branchName:'worktree/'+task.id,baseCommit:'abcdef'};if(!state.deferPreparation)bind(task);changed()};
    const service:any={
      async list(r:any){state.calls.push({op:'list',...r});const result=clone({tasks:rows(r),concurrency:state.concurrency});if(state.delayList){state.delayList=false;return new Promise(resolve=>state.pending.push(()=>resolve(result)))}return result},
      async create(r:any){state.calls.push({op:'create',...r});if(state.failSave){state.failSave=false;throw new Error('Synthetic save failed')}const now=Date.now();const task={...r,id:'task-'+state.tasks.length,status:'todo',archived:false,stopPending:false,runSeq:0,runText:r.prompt,commandId:'command',sessionRequestId:'request',createdAt:now,updatedAt:now};state.tasks.push(task);changed();return clone(task)},
      async update(r:any){state.calls.push({op:'update',...r});if(state.delaySave){state.delaySave=false;await new Promise<void>(resolve=>state.pendingSaves.push(resolve))}if(state.failSave){state.failSave=false;throw new Error('Synthetic save failed')}const task=get(r);Object.assign(task,r,{runText:r.prompt,updatedAt:Date.now()});changed();return clone(task)},
      async start(r:any){state.calls.push({op:'start',...r});if(state.delayStart){state.delayStart=false;await new Promise<void>(resolve=>state.pendingStarts.push(resolve))}if(state.failStart){state.failStart=false;throw new Error('Synthetic start failed')}const task=get(r);start(task,r.feedback);return clone(task)},
      async startAll(r:any){state.calls.push({op:'startAll',...r});for(const task of rows(r))if(task.status==='todo')start(task)},
      async cancel(r:any){state.calls.push({op:'cancel',...r});const task=get(r);if(task.merge&&!['merged','failed','canceled'].includes(task.merge.phase)){if(task.merge.phase==='applying')throw new Error('work-task.merge-applying');task.merge.phase='canceled';task.status='review'}else task.status='canceled';changed();return clone(task)},
      async complete(r:any){state.calls.push({op:'complete',...r});if(state.delayComplete){state.delayComplete=false;await new Promise<void>(resolve=>state.pendingCompletions.push(resolve))}if(state.failComplete){state.failComplete=false;throw new Error('Synthetic completion failed')}const task=get(r);if(task.status!=='review'||task.stopPending||(task.merge&&!['merged','failed','canceled'].includes(task.merge.phase)))throw new Error('work-task.not-reviewable');task.status='done';task.completion='accepted_without_merge';changed();return clone(task)},
      async merge(r:any){state.calls.push({op:'merge',...r});if(state.failMerge){state.failMerge=false;throw new Error('work-task.merge-target-dirty')}const task=get(r);task.status='queued';task.runSeq++;task.failureReason=undefined;task.merge={id:crypto.randomUUID(),projectPath:task.worktree.projectPath,targetBranch:r.targetBranch,phase:'queued'};changed();return clone(task)},
      async archive(r:any){state.calls.push({op:'archive',...r});const task=get(r);task.archived=r.archived;changed();return clone(task)},
      async setConcurrency(r:any){state.calls.push({op:'concurrency',...r});state.concurrency=r.concurrency;changed()},
      async getEvents(){return [{sequence:1,taskId:'task',runSeq:1,at:0,type:'created'}]},
      onDynamicChanged:()=> (listener:()=>void)=>{listeners.add(listener);return {dispose:()=>listeners.delete(listener)}},
    };
    state.seed=(draft:any)=>{const now=Date.now();const task={workspacePath:'/synthetic/project',execution:{kind:'api',modelSelection:clone(modelView.preferredSelection),mode:'build'},id:'task-'+state.tasks.length,status:'todo',archived:false,stopPending:false,runSeq:0,runText:draft.prompt,commandId:'command',sessionRequestId:'request',createdAt:now,updatedAt:now,...draft};state.tasks.push(task);changed();return clone(task)};
    state.notify=changed;
    state.pendingSaves=[];state.pendingStarts=[];state.finishSave=()=>state.pendingSaves.shift()?.();state.finishStart=()=>state.pendingStarts.shift()?.();
    state.pendingCompletions=[];state.finishComplete=()=>state.pendingCompletions.shift()?.();
    state.archive=(id:string,archived:boolean)=>service.archive({id,workspacePath:'/synthetic/project',archived});
    state.status=(id:string,status:string)=>{const task=get({id,workspacePath:'/synthetic/project'});task.status=status;task.updatedAt=Date.now();changed()};
    state.completePreparation=(id:string)=>{bind(get({id,workspacePath:'/synthetic/project'}));changed()};
    state.failPreparation=(id:string)=>{const task=get({id,workspacePath:'/synthetic/project'});task.status='failed';task.failureReason='Synthetic git preparation failed';changed()};
    state.finish=()=>state.pending.shift()?.();
    const services:any={workTaskService:service,gitService:{async getWorkspaceRepositoryInfo(r:any){return {...r,kind:'main-tree',repoRoot:r.workspacePath,isGitAvailable:true}}},modelSelectionService:{async getView(){return modelView},onDidChange(){return {dispose(){}}}},acpService:{async listAvailableAgents(){return [{agent:'codex',enabled:true,ready:true},{agent:'claude',enabled:true,ready:true},{agent:'kimi-code',enabled:true,ready:true},{agent:'gemini',enabled:false,ready:true},{agent:'qoder',enabled:true,ready:false}]},async list(){state.calls.push({op:'acp-list'});return []},async listAgentConfigs(r:any){state.calls.push({op:'acp-catalog',...r});if(state.failConfig){state.failConfig=false;throw new Error('Synthetic catalog failed')}const result=clone(state.catalog);if(state.delayConfigs){state.delayConfigs=false;return new Promise(resolve=>state.pendingConfigs.push(()=>resolve(result)))}return result},onDynamicAgentConfigsChanged:()=> (listener:()=>void)=>{state.agentListeners.add(listener);return {dispose:()=>state.agentListeners.delete(listener)}},async create(){state.calls.push({op:'acp-create'});throw new Error('Selection must not create an ACP session')},async prompt(){state.calls.push({op:'acp-prompt'});throw new Error('Selection must not prompt')}}};
    state.gitReads=[];state.gitBranches=['main','release'];state.currentBranch='main';
    services.gitService.getLocalBranches=async(r:any)=>{state.gitReads.push(r);if(state.failBranches){state.failBranches=false;throw new Error('Synthetic branch read failed')}return {headRefType:'branch',currentBranchName:state.currentBranch,branches:state.gitBranches.map((name:string)=>({name,isCurrent:name===state.currentBranch,upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}))}};
    state.advanceMerge=(id:string,phase:string)=>{const task=get({workspacePath:'/synthetic/project',id});Object.assign(task.merge,{phase,sourceCommit:'source-hash',targetCommit:'target-hash'});task.status=phase==='merged'?'done':['failed','canceled'].includes(phase)?'review':phase==='awaiting_input'?'awaiting_input':'running';if(['resolving','awaiting_input','applying','merged','failed'].includes(phase)){task.merge.worktree??={rootPath:'/synthetic/trees',path:'/synthetic/trees/merge-'+id+'/project',projectPath:task.workspacePath,branchName:'merge/'+id,baseCommit:'target-hash'};task.merge.session??={kind:task.execution.kind,id:'resolver-'+id};task.merge.conflicts=['src/conflict.ts']}if(phase==='merged'){task.merge.resultCommit='result-hash';task.completion='merged'}if(phase==='failed'){task.merge.error='work-task.merge-unresolved';task.failureReason=task.merge.error}changed()};
    for(const method of ['refresh','setConfigOption','setGoal','manageAgent','updateAgent'])services.acpService[method]=async()=>{state.calls.push({op:'acp-'+method});throw new Error('Pending task must not connect or configure an agent')};
    const tabs:any=[{workspacePath:'/synthetic/project',label:'Project',workspacePurpose:'project'},{workspacePath:'/synthetic/other',label:'Other',workspacePurpose:'project'}];
    const conversationTab:any={workspacePath:'/synthetic/default',label:'Conversation',workspacePurpose:'conversation'};
    const toolTargetChanged=(target:any)=>{state.toolTarget=clone(target)};
    const platform:any={async getInstalledEditors(){return [{id:'finder',name:'Finder',iconDataUrl:toolIcon},{id:'vscode',name:'VS Code',iconDataUrl:toolIcon}]},async openInEditor(editor:string,path:string,options:any){state.toolCalls.push({op:'editor',editor,path,options});return {success:true}},async openExternal(url:string){state.toolCalls.push({op:'external',url})}};
    ${workTaskPromptAssetsFixture}
    ${workTaskPanelFixture}
    const broadcast:any={send(){},onMessage(){return {dispose(){}}}};
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform}><ZCodeIntlProvider initialLocale='zh-CN'><TooltipProvider><StoreProvider broadcastService={broadcast}><TabStoreProvider><Fixture/></TabStoreProvider></StoreProvider></TooltipProvider></ZCodeIntlProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await routeWorkTaskConversationFixture(page);
  await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
  await page.waitForLoadState("networkidle");
  const scenario = workTaskScenarios[process.env.ZCODE_E2E_SCENARIO];
  if (scenario) {
    await scenario(page, artifacts);
    assert.deepEqual(errors, []);
    process.stdout.write(`Screenshots: ${artifacts}\n`);
  } else {
    const panel = page.getByTestId("work-tasks-panel");
    const editor = page.getByTestId("work-task-editor");
    const detail = page.getByTestId("work-task-detail");
    const card = (id) => panel.locator(`[data-testid="work-task-card"][data-task-id="${id}"]`);
    const cardAction = async (id, name) => {
      await card(id).getByRole("button", { name: "任务操作", exact: true }).click();
      // 连续操作要等菜单退出；否则下一次可能选中仍在退出动画中的旧菜单。
      const menu = page.locator('[role="menu"][data-state="open"]');
      await menu.getByRole("menuitem", { name, exact: true }).click();
      await page.getByRole("menu").waitFor({ state: "detached" });
    };
    const openDetails = async (id, title) => {
      await card(id).getByRole("button", { name: title, exact: true }).click();
      await panel.getByRole("button", { name: "任务详情", exact: true }).click();
      await detail.waitFor();
    };
    const assertBoardOnly = () => assertWorkTaskBoardOnly(panel);
    await assertBoardOnly();
    assert.ok(await panel.getByTestId("work-task-start-all").isDisabled());
    assert.equal(
      await panel.getByRole("alert").count(),
      0,
      "empty board must not show static errors",
    );
    await exerciseWorkTaskWorkbenchLayout(page, panel);
    await exerciseWorkTaskBoardResize(page, panel);
    await panel.getByTestId("work-task-new").click();

    await editor.getByTestId("work-task-prompt").fill("Implement an API task");
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "create").length),
      0,
    );
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
    await card("task-0").waitFor();
    assert.equal(await page.evaluate(() => window.__tasks.tasks[0].status), "todo");
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "start").length),
      0,
      "creating a task must remain save-only",
    );
    await card("task-0")
      .getByRole("button", { name: "Implement an API task", exact: true })
      .click();
    await panel.getByTestId("work-task-unstarted").waitFor();
    await assertWorkTaskPendingChat(panel, {
      text: "Implement an API task",
      modelValue: "custom:api:TestModel",
    });
    assert.equal(await page.evaluate(() => window.__tasks.closed.length), 0);
    await cardAction("task-0", "编辑任务");
    await editor.getByTestId("work-task-prompt").fill("Edited API instructions");
    await page.evaluate(() => {
      window.__tasks.failStart = true;
    });
    await editor.getByTestId("work-task-save").click();
    await editor.getByRole("alert").waitFor();
    assert.equal(await editor.getByRole("alert").innerText(), "Synthetic start failed");
    assert.equal(
      await editor.getByTestId("work-task-prompt").innerText(),
      "Edited API instructions",
    );
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await remountWorkTaskPanel(page, panel);
    assert.equal(
      await page.evaluate(() => window.__tasks.tasks[0].prompt),
      "Edited API instructions",
    );
    const savedApi = await page.evaluate(() => window.__tasks.tasks[0].execution);
    assert.equal(savedApi.kind, "api");
    assert.equal(savedApi.modelSelection.options.reasoningLevel, "high");
    assert.equal(savedApi.mode, "build");

    await exerciseWorkTaskAgentConfigSelection(page, panel, artifacts);

    await exerciseWorkTaskAcpCreation(page, panel, card);
    await assertBoardOnly();
    await exerciseWorkTaskCompactRows(page, panel, artifacts);
    await page.evaluate(async () => {
      await window.__tasks.seed({ title: "Archived task", prompt: "Hidden", archived: true });
      await window.__tasks.seed({ title: "Canceled task", prompt: "Hidden", status: "canceled" });
    });
    assert.equal(await card("task-2").count(), 0);
    assert.equal(await card("task-3").count(), 0);
    await remountWorkTaskPanel(page, panel);
    await assertBoardOnly();
    await card("task-0").waitFor();
    await card("task-1").waitFor();
    assert.equal(await page.evaluate(() => window.__tasks.concurrency), 2);
    await page.evaluate(() => {
      window.__tasks.failStart = true;
    });
    await cardAction("task-0", "开始");
    await panel.getByTestId("work-task-board-scroll").getByRole("alert").waitFor();
    assert.equal(
      await panel.getByTestId("work-task-board-scroll").getByRole("alert").innerText(),
      "Synthetic start failed",
    );
    assert.equal(await page.evaluate(() => window.__tasks.tasks[0].status), "todo");
    await exerciseWorkTaskSelection(page, panel, card, cardAction, artifacts);
    await exerciseWorkTaskWorkspaceTools(page, panel, card, artifacts);
    const batchStarts = await page.evaluate(() =>
      window.__tasks.calls.filter((c) => c.op === "startAll"),
    );
    assert.equal(batchStarts.length, 1);
    assert.equal(batchStarts[0].workspacePath, "/synthetic/project");
    assert.equal(
      await page.evaluate(() => window.__tasks.tasks[2].status),
      "todo",
      "archived tasks must not start",
    );
    assert.equal(await page.evaluate(() => window.__tasks.tasks[3].status), "canceled");
    await card("task-0")
      .getByRole("button", { name: "Implement an API task", exact: true })
      .click();
    await assertWorkTaskSessionTarget(
      panel,
      "api",
      "session-task-0",
      "/synthetic/trees/task-0/project",
    );
    assert.equal(await card("task-0").getAttribute("data-selected"), "true");
    await openDetails("task-0", "Implement an API task");
    await detail.getByTestId("work-task-open-conversation").click();
    await detail.waitFor({ state: "detached" });
    await assertWorkTaskSessionTarget(
      panel,
      "api",
      "session-task-0",
      "/synthetic/trees/task-0/project",
    );
    await page.evaluate(() => window.__tasks.status("task-1", "awaiting_input"));
    await card("task-1").locator('[data-work-task-status="awaiting_input"]').waitFor();
    await openDetails("task-1", "Implement an ACP task");
    await detail.getByRole("button", { name: "处理会话中的请求", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    await assertWorkTaskSessionTarget(
      panel,
      "acp",
      "session-task-1",
      "/synthetic/trees/task-1/project",
    );
    await exerciseWorkTaskConversationResize(page, panel);
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "conversation").length),
      0,
      "task selection and detail conversation actions must stay in the workbench",
    );
    await page.evaluate(() => {
      window.__lateTaskArchive = window.__tasks.closed.at(-1);
    });
    await card("task-0")
      .getByRole("button", { name: "Implement an API task", exact: true })
      .click();
    await assertWorkTaskSessionTarget(
      panel,
      "api",
      "session-task-0",
      "/synthetic/trees/task-0/project",
    );
    await page.evaluate(() => window.__lateTaskArchive("session-task-1"));
    await assertWorkTaskSessionTarget(
      panel,
      "api",
      "session-task-0",
      "/synthetic/trees/task-0/project",
    );
    await cardAction("task-0", "取消执行");
    await card("task-0").waitFor({ state: "detached" });
    await panel.getByTestId("work-task-no-selection").waitFor();
    await page.evaluate(() => window.__tasks.status("task-0", "failed"));
    await card("task-0").waitFor();
    await cardAction("task-0", "重新开始");
    await card("task-0").locator('[data-work-task-status="running"]').waitFor();
    await page.evaluate(() => window.__tasks.status("task-1", "review"));
    await openDetails("task-1", "Implement an ACP task");
    await detail.getByTestId("work-task-feedback").fill("Add the missing test");
    await detail.getByTestId("work-task-follow-up").click();
    await detail.locator('[data-work-task-status="running"]').waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__tasks.calls.find((c) => c.op === "start" && c.id === "task-1" && c.feedback)
            .feedback,
      ),
      "Add the missing test",
    );
    assert.equal(await page.evaluate(() => window.__tasks.tasks[1].session.id), "session-task-1");
    await page.evaluate(() => window.__tasks.status("task-1", "review"));
    assert.equal(await detail.getByTestId("work-task-complete").count(), 0);
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });
    await panel.getByTestId("work-task-content").getByTestId("work-task-complete").click();
    const confirm = page.getByRole("alertdialog");
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "complete").length),
      0,
    );
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await panel.getByTestId("work-task-content").getByTestId("work-task-complete").click();
    await confirm.getByRole("button", { name: "确认完成", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await openDetails("task-1", "Implement an ACP task");
    await detail.locator('[data-work-task-status="done"]').waitFor();
    await detail.getByRole("button", { name: "归档", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    await card("task-1").waitFor({ state: "detached" });
    await panel.getByTestId("work-task-no-selection").waitFor();
    assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 0);
    await page.evaluate(() => window.__tasks.archive("task-1", false));
    await card("task-1").waitFor();
    await panel.getByTestId("work-task-no-selection").waitFor();
    await card("task-1")
      .getByRole("button", { name: "Implement an ACP task", exact: true })
      .click();
    await assertWorkTaskSessionTarget(
      panel,
      "acp",
      "session-task-1",
      "/synthetic/trees/task-1/project",
    );

    await exerciseWorkTaskProjectReadRace(page, panel, card, assertBoardOnly);
    await exerciseWorkTaskResponsiveLayout(page, panel, artifacts);
    await exerciseWorkTaskAgentConfigPersistence(page, panel);
    await exerciseWorkTaskHomeRepositoryError(page, panel, card, artifacts);
    await exerciseWorkTaskProjectBoundary(page, panel, card);
    assert.equal(await page.evaluate(() => window.__tasks.concurrency), 2);
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.some((call) => call.op === "concurrency")),
      false,
      "compact toolbar must not change saved project concurrency",
    );
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "create").length),
      4,
    );
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.filter((call) => call.op === "startAll").length,
      ),
      1,
    );
    await exerciseWorkTaskExecutionPreferences(page, artifacts);
    await exerciseWorkTaskEditRestart(page, artifacts);
    await exerciseWorkTaskConversationStatus(page, artifacts);
    await exerciseWorkTaskPromptAttachments(page, artifacts);
    await exerciseWorkTaskImageResources(page, artifacts);
    await exerciseWorkTaskPendingImages(page, artifacts);
    await exerciseWorkTaskCompletion(page, artifacts);
    await exerciseWorkTaskConcurrentExecution(page, artifacts);
    assert.deepEqual(errors, []);
    process.stdout.write(
      `PASS: compact single-line API/ACP tasks, long titles and 24-task scrolling in both responsive themes, agent tooltips and icon selection, compact toolbar with new task/start all only, API + ACP create/edit and scoped batch start, disabled controls without a project or pending tasks, removed filters/static hints, preserved header/four board sections, API/ACP conversation headers without a main-view jump and preserved inline detail actions, default archive/cancel hiding and saved concurrency, shared chat/composer and zero preview commands, full-row/keyboard selection and menu isolation, preparing/binding/failure events, project boundary, draft retention and mutation error feedback, pointer/keyboard resize and layout restore, start/cancel/retry, permission jump, feedback, explicit completion, archive, event refresh/project read race and responsive themes, scoped API/ACP execution preferences after cancel/reopen/reload and history-edit isolation, API/ACP edit-save restart with retained bindings and new instructions, continuous busy and duplicate-submit rejection, save/start failure retention, cancel and non-executable save-only boundaries, API/ACP continued-conversation status updates in board/header without closing/remounting or resending. Screenshots: ${artifacts}\n`,
    );
  }
} catch (error) {
  if (errors.length) process.stderr.write(`Page errors: ${errors.join("\n")}\n`);
  await captureWorkTaskLayoutFailure(browser, artifacts);
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
