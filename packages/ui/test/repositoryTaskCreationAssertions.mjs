import assert from "node:assert/strict";
import { join } from "node:path";
import { selectWorkTaskExecution } from "./workTaskExecutionConfigAssertions.mjs";
import { assertRepositoryStateFilter } from "./repositoryStateFilterAssertions.mjs";
import { assertRepositoryTaskStatusColors } from "./repositoryTaskStatusAssertions.mjs";

export async function exerciseRepositoryTaskCreation(page, panel, artifacts) {
  const handle = () => panel.getByTestId("repository-item-handle").first();
  const editor = page.getByTestId("work-task-editor");
  const creates = () =>
    page.evaluate(() => window.__forge.calls.filter((c) => c.op === "task-create"));
  const remount = async () => {
    await page.evaluate(() => {
      window.__forge.resetTasks();
      window.__forge.remount();
    });
    await handle().waitFor();
    assert.equal(await handle().innerText(), "处理");
  };
  const open = async () => {
    await handle().click();
    await editor.waitFor();
    await editor.getByTestId("work-task-model").waitFor();
  };
  const cancel = async () => {
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  };
  const save = async () => {
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="work-task-save"]')?.disabled,
    );
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
  };
  const select = (value) => selectWorkTaskExecution(page, editor, value);
  const beforeSave = await handle().boundingBox();
  assert.equal(await handle().getAttribute("data-variant"), "ghost");
  await handle().focus();
  await page.keyboard.press("Enter");
  await editor.waitFor();
  assert.match(await editor.getByTestId("work-task-prompt").innerText(), /Full detail only/);
  assert.equal((await creates()).length, 0);
  await cancel();
  assert.equal((await creates()).length, 0);

  await open();
  const beforeCancel = (await creates()).length;
  await page.evaluate(() => {
    const form = document.querySelector('[data-testid="work-task-editor"] form');
    form.requestSubmit();
    [...form.querySelectorAll("button")].find((button) => button.textContent === "取消").click();
  });
  await editor.waitFor({ state: "detached" });
  assert.equal((await creates()).length, beforeCancel);

  // 连点只能读一次、打开一个弹窗，直到确认前都不能创建待办。
  await page.evaluate(() => {
    window.__forge.delayDetail = true;
    const button = document.querySelector('[data-testid="repository-item-handle"]');
    button.click();
    button.click();
  });
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  assert.equal(await handle().isDisabled(), true);
  await page.evaluate(() => window.__forge.finish());
  await editor.waitFor();
  assert.equal((await creates()).length, 0);
  await select("custom:synthetic:other");
  await save();
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  const api = (await creates()).at(-1);
  assert.equal(api.workspacePath, "/synthetic/A");
  assert.equal(api.host, "A");
  assert.equal(api.title, "A origin issue 1");
  assert.match(api.prompt, /Full detail only/);
  assert.match(api.prompt, /外部仓库/);
  assert.match(api.prompt, /issues\/7/);
  assert.equal(api.execution.modelSelection.providerId, "synthetic");
  assert.equal(api.execution.modelSelection.modelId, "other");
  assert.equal(api.sourceBranch, "main");
  assert.equal(await page.evaluate(() => window.__forge.tasks[0].status), "todo");
  assert.ok(Math.abs(beforeSave.width - (await handle().boundingBox()).width) < 1);
  assert.equal(api.source.number, 7);
  assert.equal(api.source.repositoryKey, "Aorigin");
  await page.evaluate(() => window.__forge.remount());
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  await assertRepositoryTaskStatusColors(page, panel, artifacts);
  for (const [status, label] of [
    ["running", "处理中"],
    ["review", "待验收"],
    ["done", "已处理"],
  ]) {
    await page.evaluate((status) => window.__forge.taskStatus(status), status);
    await panel.getByRole("button", { name: label, exact: true }).waitFor();
  }
  await panel.getByRole("button", { name: "重新处理", exact: true }).click();
  await editor.waitFor();
  await cancel();
  await handle().click();
  assert.equal(await editor.count(), 0);
  assert.equal((await creates()).length, 1);
  await panel.getByTestId("repository-item-row").first().click();
  const linkedDetail = panel.getByTestId("repository-item-detail");
  await linkedDetail.waitFor();
  await page.evaluate(() => window.__forge.completeIssue());
  await linkedDetail.getByText("Task accepted and issue closed", { exact: true }).waitFor();
  await linkedDetail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await panel.getByTestId("repository-item-row").waitFor({ state: "detached" });
  await page.evaluate(() => window.__forge.resetIssue());
  await remount();

  await page.evaluate(() => {
    window.__forge.failDetail = true;
  });
  await handle().click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await editor.count(), 0);
  await open();
  await select("acp:codex");
  await editor.getByTestId("acp-config-trigger-model").click();
  await page.getByTestId("acp-config-choice-model-synthetic-acp").click();
  await editor.getByTestId("work-task-prompt").fill("Keep this edited issue instruction");
  await page.evaluate(() => {
    window.__forge.failTask = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.equal(
    await editor.getByTestId("work-task-prompt").innerText(),
    "Keep this edited issue instruction",
  );
  await save();
  assert.deepEqual((await creates()).at(-1).execution, {
    kind: "acp",
    agent: "codex",
    config: [{ configId: "model", value: "synthetic-acp" }],
  });
  await remount();

  const rememberedApi = {
    kind: "api",
    mode: "plan",
    modelSelection: {
      providerId: "synthetic",
      modelId: "model",
      options: { reasoningLevel: "low" },
    },
  };
  await page.evaluate(
    (execution) => window.__forge.remember({ workspacePath: "/synthetic/A" }, execution),
    rememberedApi,
  );
  await open();
  await save();
  assert.deepEqual((await creates()).at(-1).execution, rememberedApi);
  await remount();

  // 没有默认 API 仍可主动选择 ACP；选择消失时绝不能回退到 API。
  await page.evaluate(() => {
    window.__forge.noModel = true;
  });
  await open();
  await select("acp:codex");
  const beforeUnavailable = (await creates()).length;
  await page.evaluate(() => {
    window.__forge.noAgent = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.equal((await creates()).length, beforeUnavailable);
  assert.match(await editor.getByRole("alert").innerText(), /重新选择/);
  await page.evaluate(() => {
    window.__forge.noAgent = false;
  });
  await save();
  assert.equal((await creates()).at(-1).execution.kind, "acp");
  await page.evaluate(() => {
    window.__forge.noModel = false;
  });
  await remount();

  // 读取尚未结束和草稿已打开时切换 Host/remote 都不能留下可提交的旧草稿。
  for (const stage of ["read", "editor", "validation"]) {
    for (const change of ["host", "remote"]) {
      const before = (await creates()).length;
      if (stage === "read")
        await page.evaluate(() => {
          window.__forge.delayDetail = true;
        });
      await handle().click();
      if (stage === "read") await page.waitForFunction(() => window.__forge.pending.length === 1);
      else {
        await editor.waitFor();
        if (stage === "validation") {
          await select("acp:codex");
          await page.evaluate(() => {
            window.__forge.delayAgents = true;
          });
          await editor.getByTestId("work-task-save").click();
          await page.waitForFunction(() => window.__forge.pending.length === 1);
        }
      }
      if (change === "host") await page.evaluate(() => window.__forge.switchHost("B"));
      else
        await page.evaluate(() => {
          // Dialog intentionally blocks background input; simulate an external remote change.
          window.__forge.changeRemote();
        });
      await editor.waitFor({ state: "detached" });
      if (stage !== "editor") await page.evaluate(() => window.__forge.finish());
      await page.waitForFunction(() => window.__forge.pending.length === 0);
      assert.equal((await creates()).length, before);
      await page.evaluate(() => {
        window.__forge.switchHost("A");
        window.__forge.remount();
      });
      await handle().waitFor();
    }
  }

  await page.evaluate(() => {
    window.__forge.taskRemote = true;
    window.__forge.remount();
  });
  await open();
  await select("acp:codex");
  await save();
  const remote = (await creates()).at(-1);
  assert.equal(remote.host, "B");
  assert.equal(remote.workspacePath, "/synthetic/A");
  assert.equal(remote.workspaceIdentity, "synthetic-task-identity");
  assert.equal(remote.remoteSessionId, "task-remote");
  await page.evaluate(() => {
    window.__forge.taskRemote = false;
    window.__forge.remount();
  });
  await open();
  const beforeDouble = (await creates()).length;
  await page.evaluate(() => {
    window.__forge.delayTask = true;
    const form = document.querySelector('[data-testid="work-task-editor"] form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  assert.equal((await creates()).length, beforeDouble + 1);
  await page.evaluate(() => window.__forge.switchHost("B"));
  await editor.waitFor({ state: "detached" });
  await page.evaluate(() => window.__forge.finish());
  await page.waitForFunction(() => window.__forge.tasks.at(-1)?.workspacePath === "/synthetic/A");
  assert.equal(await handle().innerText(), "处理");

  for (const theme of ["theme-zai-light", "theme-zai-dark dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
    }, theme);
    await page.setViewportSize({ width: 320, height: 850 });
    await open();
    assert.ok(await editor.getByTestId("work-task-model").isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="work-task-save"]')?.disabled,
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: join(artifacts, `task-editor-${theme.includes("dark") ? "dark" : "light"}.png`),
    });
    await cancel();
    assert.ok(await handle().isVisible());
  }
  assert.equal(
    await page.evaluate(() =>
      window.__forge.calls.some((c) =>
        ["agent", "acp-create", "acp-prompt", "start"].includes(c.op),
      ),
    ),
    false,
  );
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    document.documentElement.className = "theme-zai-light";
    window.__forge.switchHost("A");
    window.__forge.remount();
  });
  await handle().waitFor();
  await assertRepositoryStateFilter(page, panel, artifacts);
}

export const repositoryTaskServicesFixture = `
    state.tasks=[];
    const taskListeners:any={A:new Set(),B:new Set()};
    state.resetTasks=()=>{state.tasks=[];for(const callbacks of Object.values(taskListeners) as any[])for(const callback of callbacks)callback()};
    state.taskStatus=(status:string)=>{state.tasks[0].status=status;for(const callbacks of Object.values(taskListeners) as any[])for(const callback of callbacks)callback()};
    state.execution={kind:'api',mode:'plan',modelSelection:{providerId:'synthetic',modelId:'model',options:{reasoningLevel:'high'}}};
    state.remember=(scope:any,execution:any)=>workTaskExecutionPreferenceStore.getState().remember(scope,execution);
    for(const host of ['A','B']) {
    hosts[host].gitService.getLocalBranches=async()=>({headRefType:'branch',currentBranchName:'main',branches:[{name:'main',isCurrent:true,upstreamName:null,commitHash:'abcdef',commitTimestampMs:1}]});
    Object.assign(hosts[host], {clientConfigService:{async getSnapshot(){state.calls.push({op:'forbidden-client-config'});throw new Error('Files-only editor must not load plugins')}},modelSelectionService:{async getView(){return {revision:1,providers:state.noModel?[]:[{providerId:'synthetic',providerName:'Synthetic',config:{api:{type:'openai-chat-completions'}},models:[{modelId:'model',config:{optionSpecs:{reasoningLevel:{values:['low','high']}}}},{modelId:'other',config:{optionSpecs:{}}}]}],preferredSelection:state.noModel?null:state.execution.modelSelection}},onDidChange(){return {dispose(){}}}},
    acpService:{async listAvailableAgents(){state.calls.push({host,op:'agents'});if(state.delayAgents){state.delayAgents=false;await new Promise(resolve=>state.pending.push(resolve))}return [{agent:'codex',enabled:true,ready:!state.noAgent}]},async listAgentConfigs(){return [{agent:'codex',source:'host',modeState:null,configOptions:[{id:'model',name:'Model',type:'select',category:'model',currentValue:'synthetic-acp',options:[{value:'synthetic-acp',name:'Synthetic ACP'}]}]}]},onDynamicAgentConfigsChanged:()=>()=>({dispose(){}}),async create(){state.calls.push({op:'acp-create'});throw new Error('Must not launch')},async prompt(){state.calls.push({op:'acp-prompt'});throw new Error('Must not prompt')}},
    workTaskService:{async list(r:any){return {tasks:clone(state.tasks.filter((t:any)=>t.workspacePath===r.workspacePath&&t.workspaceIdentity===r.workspaceIdentity)),concurrency:1}},onDynamicChanged:()=> (callback:any)=>{taskListeners[host].add(callback);return {dispose(){taskListeners[host].delete(callback)}}},async create(r:any){state.calls.push({host,op:'task-create',...clone(r)});if(state.failTask){state.failTask=false;throw new Error('Synthetic task save failure')}if(state.delayTask){state.delayTask=false;await new Promise(resolve=>state.pending.push(resolve))}const task={...clone(r),id:crypto.randomUUID(),status:'todo',createdAt:Date.now(),updatedAt:Date.now()};state.tasks.push(task);for(const callback of taskListeners[host])callback();return task},async start(){state.calls.push({op:'start'});throw new Error('Handle must never start a task')}}});}
    useRemoteWorkspaceSessionStore.getState().registerSession({sessionId:'task-remote',services:hosts.B});
`;

export const importsFixture = `
    import {workTaskExecutionPreferenceStore} from '../../../ui/src/store/workTaskExecutionPreferenceStore.ts';
    import {useRemoteWorkspaceSessionStore} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
`;

export function observeRepositoryErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    process.stderr.write(`Page error: ${error.stack ?? error.message}\n`);
  });
  return errors;
}

export async function exerciseRepositoryDetailTaskCreation(page, detail) {
  await page.evaluate(() => window.__forge.resetTasks());
  const editor = page.getByTestId("work-task-editor");
  const count = () =>
    page.evaluate(() => window.__forge.calls.filter((c) => c.op === "task-create").length);
  await detail.getByRole("button", { name: "交给智能体处理", exact: true }).click();
  await editor.waitFor();
  assert.match(await editor.getByTestId("work-task-prompt").innerText(), /外部仓库/);
  const before = await count();
  await editor.getByTestId("work-task-model").click();
  await page.getByTestId("chat-model-select-item-acp:codex").click();
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await count(), before + 1);
  await detail.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
}
