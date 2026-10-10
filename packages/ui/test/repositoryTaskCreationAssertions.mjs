import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseRepositoryTaskCreation(page, panel, artifacts) {
  const handle = () => panel.getByTestId("repository-item-handle").first();
  const creates = () =>
    page.evaluate(() => window.__forge.calls.filter((c) => c.op === "task-create"));
  const remount = async () => {
    await page.evaluate(() => window.__forge.remount());
    await handle().waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="repository-item-handle"]')?.innerText === "处理",
    );
  };
  const beforeSave = await handle().boundingBox();
  assert.equal(await handle().getAttribute("data-variant"), "ghost");
  assert.equal(await handle().locator("svg").count(), 1);
  await handle().focus();
  assert.ok(await handle().evaluate((button) => button === document.activeElement));
  // Two clicks in one browser turn must admit exactly one read/save chain.
  await page.evaluate(() => {
    window.__forge.delayDetail = true;
    const button = document.querySelector('[data-testid="repository-item-handle"]');
    button.click();
    button.click();
  });
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  assert.equal(await handle().isDisabled(), true);
  assert.equal((await creates()).length, 0);
  await page.evaluate(() => window.__forge.finish());
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  const afterSave = await handle().boundingBox();
  assert.ok(Math.abs(beforeSave.width - afterSave.width) < 1, "success must not resize the action");
  assert.equal(await handle().evaluate((button) => getComputedStyle(button).opacity), "1");
  for (const theme of ["theme-zai-light", "theme-zai-dark dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
    }, theme);
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: join(artifacts, `task-saved-${theme.includes("dark") ? "dark" : "light"}.png`),
    });
  }
  const [api] = await creates();
  assert.equal(api.workspacePath, "/synthetic/A");
  assert.equal(api.host, "A");
  assert.equal(api.title, "A origin issue 1");
  assert.match(api.prompt, /Full detail only/);
  assert.match(api.prompt, /外部仓库/);
  assert.match(api.prompt, /issues\/7/);
  assert.equal(api.execution.kind, "api");
  assert.equal(api.execution.modelSelection.options.reasoningLevel, "high");
  assert.equal(await page.evaluate(() => window.__forge.tasks[0].status), "todo");
  assert.equal(await panel.getByTestId("repository-item-detail").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.__forge.calls.some((c) =>
        ["agent", "create", "comment", "merge", "state"].includes(c.op),
      ),
    ),
    false,
  );
  assert.equal(await handle().isDisabled(), true);
  await remount();

  for (const failure of ["failDetail", "failTask", "noModel"]) {
    const before = (await creates()).length;
    await page.evaluate((f) => {
      window.__forge[f] = true;
    }, failure);
    await handle().click();
    await panel.getByRole("alert").waitFor();
    assert.equal(await handle().isEnabled(), true);
    assert.equal((await creates()).length, before + (failure === "failTask" ? 1 : 0));
    if (failure === "noModel")
      assert.match(await panel.getByRole("alert").innerText(), /配置模型或智能体/);
    await page.evaluate(() => {
      window.__forge.noModel = false;
    });
    await handle().click();
    await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
    await remount();
  }
  const acp = {
    kind: "acp",
    agent: "codex",
    config: [
      { configId: "model", value: "synthetic-acp" },
      { configId: "fast", value: false },
    ],
  };
  await page.evaluate(
    (execution) => window.__forge.remember({ workspacePath: "/synthetic/A" }, execution),
    acp,
  );
  await handle().focus();
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  assert.deepEqual((await creates()).at(-1).execution, acp);
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
  await handle().click();
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  assert.deepEqual((await creates()).at(-1).execution, rememberedApi);
  await remount();

  // Late full-item reads cannot create under the old project or remote.
  for (const change of ["host", "remote"]) {
    const before = (await creates()).length;
    await page.evaluate(() => {
      window.__forge.delayDetail = true;
    });
    await handle().click();
    await page.waitForFunction(() => window.__forge.pending.length === 1);
    if (change === "host") await page.evaluate(() => window.__forge.switchHost("B"));
    else {
      await panel.getByRole("combobox", { name: "远端仓库", exact: true }).click();
      await page.getByRole("option", { name: "private", exact: true }).click();
    }
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="repository-item-row"]')
          ?.textContent?.includes(expected),
      change === "host" ? "B origin" : "A private",
    );
    await page.evaluate(() => window.__forge.finish());
    await page.waitForFunction(() => window.__forge.pending.length === 0);
    assert.equal((await creates()).length, before);
    await page.evaluate(() => {
      window.__forge.switchHost("A");
      window.__forge.remount();
    });
    await handle().waitFor();
  }
  await page.evaluate(() => {
    window.__forge.taskRemote = true;
    window.__forge.remount();
  });
  await handle().waitFor();
  await handle().click();
  await panel.getByRole("button", { name: "已加入待办", exact: true }).waitFor();
  const remote = (await creates()).at(-1);
  assert.equal(remote.host, "B");
  assert.equal(remote.workspacePath, "/synthetic/A");
  assert.equal(remote.workspaceIdentity, "synthetic-task-identity");
  assert.equal(remote.remoteSessionId, "task-remote");
  await page.evaluate(() => {
    window.__forge.taskRemote = false;
    window.__forge.remount();
  });
  await handle().waitFor();
  await page.evaluate(() => {
    window.__forge.delayTask = true;
  });
  await handle().click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await page.evaluate(() => window.__forge.switchHost("B"));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-item-row"]')
      ?.textContent?.includes("B origin"),
  );
  await page.evaluate(() => window.__forge.finish());
  await page.waitForFunction(() => window.__forge.tasks.at(-1)?.workspacePath === "/synthetic/A");
  assert.equal(await handle().innerText(), "处理");
  assert.equal(await handle().isEnabled(), true);

  for (const theme of ["theme-zai-light", "theme-zai-dark dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
    }, theme);
    await page.setViewportSize({ width: 320, height: 850 });
    assert.ok(await handle().isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const content = await panel.getByTestId("repository-item-row").first().boundingBox();
    const action = await handle().boundingBox();
    assert.ok(action.y >= content.y + content.height, "mobile action must not squeeze the title");
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
      path: join(artifacts, `task-handle-${theme.includes("dark") ? "dark" : "light"}.png`),
    });
  }
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    document.documentElement.className = "theme-zai-light";
    window.__forge.switchHost("A");
    window.__forge.remount();
  });
  await panel.getByTestId("repository-item-row").first().waitFor();
}

export const repositoryTaskServicesFixture = `
    state.tasks=[];
    state.execution={kind:'api',mode:'plan',modelSelection:{providerId:'synthetic',modelId:'model',options:{reasoningLevel:'high'}}};
    state.remember=(scope:any,execution:any)=>workTaskExecutionPreferenceStore.getState().remember(scope,execution);
    for(const host of ['A','B']) Object.assign(hosts[host], {modelSelectionService:{async getView(){return {providers:[{providerId:'synthetic',models:[{modelId:'model'}]}],preferredSelection:state.noModel?null:state.execution.modelSelection}}},
    acpService:{async listAvailableAgents(){state.calls.push({host,op:'agents'});return [{agent:'codex',enabled:true,ready:true}]}},
    workTaskService:{async create(r:any){state.calls.push({host,op:'task-create',...clone(r)});if(state.failTask){state.failTask=false;throw new Error('Synthetic task save failure')}if(state.delayTask){state.delayTask=false;await new Promise(resolve=>state.pending.push(resolve))}const task={...clone(r),id:crypto.randomUUID(),status:'todo'};state.tasks.push(task);return task},async start(){throw new Error('Handle must never start a task')}}});
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
