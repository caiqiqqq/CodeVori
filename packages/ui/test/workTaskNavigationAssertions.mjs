import assert from "node:assert/strict";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

export const workTaskNavigationFixture = `
    state.seed({id:'navigation-api',title:'Remember API',prompt:'API instructions'});
    state.seed({id:'navigation-acp',workspacePath:'/synthetic/other',title:'Remember ACP',prompt:'ACP instructions',status:'running',execution:{kind:'acp',agent:'codex',config:[]},session:{kind:'acp',id:'navigation-session'}});
    const navigationList=service.list;
    service.list=async(r:any)=>{if(state.failList){state.failList=false;throw new Error('Synthetic navigation list failure')}return navigationList(r)};
`;

export async function exerciseWorkTaskNavigation(page) {
  const panel = page.getByTestId("work-tasks-panel");
  const card = (id) => panel.locator(`[data-testid="work-task-card"][data-task-id="${id}"]`);
  const chooseProject = async (name) => {
    await panel.getByTestId("work-task-project").click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const assertSelected = async (id) => {
    await page.waitForFunction(
      (id) => document.querySelector(`[data-task-id="${id}"]`)?.dataset.selected === "true",
      id,
    );
  };
  await card("navigation-api").click();
  await chooseProject("Other");
  await card("navigation-acp").click();
  await remountWorkTaskPanel(page, panel);
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "Other");
  await assertSelected("navigation-acp");
  await page.reload();
  await assertSelected("navigation-acp");
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "Other");
  await chooseProject("Project");
  await assertSelected("navigation-api");
  await page.evaluate(() => {
    window.__tasks.delayList = true;
  });
  const oldPanel = await panel.elementHandle();
  await page.evaluate(() => window.__tasks.remount());
  await page.waitForFunction((node) => !node.isConnected, oldPanel);
  await oldPanel.dispose();
  await page.waitForFunction(() => window.__tasks.pending.length === 1);
  await page.evaluate(() => window.__tasks.finish());
  await assertSelected("navigation-api");
  await page.evaluate(() => {
    window.__tasks.failList = true;
  });
  await remountWorkTaskPanel(page, panel);
  await panel.getByRole("alert").waitFor();
  await page.evaluate(() => window.__tasks.notify());
  await assertSelected("navigation-api");
  await page.evaluate(() => {
    window.__tasks.tasks.find((task) => task.id === "navigation-api").archived = true;
    window.__tasks.notify();
  });
  await panel.getByTestId("work-task-no-selection").waitFor();
  await page.evaluate(() => {
    window.__tasks.tasks.find((task) => task.id === "navigation-api").archived = false;
    window.__tasks.notify();
  });
  await card("navigation-api").waitFor();
  await remountWorkTaskPanel(page, panel);
  await panel.getByTestId("work-task-no-selection").waitFor();
  await chooseProject("Other");
  await assertSelected("navigation-acp");
  await panel.getByRole("button", { name: "关闭任务查看", exact: true }).click();
  await remountWorkTaskPanel(page, panel);
  await panel.getByTestId("work-task-no-selection").waitFor();
  for (const mode of ["cancel", "delete"]) {
    await card("navigation-acp").click();
    await page.evaluate((mode) => {
      const task = window.__tasks.tasks.find((task) => task.id === "navigation-acp");
      if (mode === "cancel") task.status = "canceled";
      else window.__tasks.tasks = window.__tasks.tasks.filter((row) => row.id !== task.id);
      window.__tasks.notify();
    }, mode);
    await panel.getByTestId("work-task-no-selection").waitFor();
    await page.evaluate(() => {
      if (!window.__tasks.tasks.some((task) => task.id === "navigation-acp"))
        window.__tasks.seed({
          id: "navigation-acp",
          workspacePath: "/synthetic/other",
          title: "Remember ACP",
          prompt: "ACP instructions",
        });
      else window.__tasks.tasks.find((task) => task.id === "navigation-acp").status = "running";
      window.__tasks.notify();
    });
    await card("navigation-acp").waitFor();
    await remountWorkTaskPanel(page, panel);
    await panel.getByTestId("work-task-no-selection").waitFor();
  }
  await page.evaluate(() => window.__tasks.setWorkspace("none"));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="work-task-project"]')?.textContent === "未选择项目",
  );
  assert.ok(await panel.getByTestId("work-task-project").isDisabled());
  await page.evaluate(() => window.__tasks.setWorkspace("conversation"));
  await card("navigation-acp").waitFor();
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "Other");
  assert.deepEqual(
    await page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list")),
    [],
    "navigation restoration must not issue business writes or Agent requests",
  );
  process.stdout.write(
    "PASS: project and API/ACP task restore on remount/reload, per-project selections, delayed/failed first read, unavailable project, archive/cancel/delete clearing and explicit close, zero business writes\n",
  );
}
