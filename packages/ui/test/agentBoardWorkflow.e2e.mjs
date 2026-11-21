// Actual SettingsPage and AgentBoardPanel, synthetic Host; no model or Git writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
import { agentBoardWorkflowFixture } from "./agentBoardWorkflowFixture.mjs";
import {
  assertBuiltinWorkflow,
  assertDefaultProjectSelection,
} from "./taskWorkflowDefaults.e2e-helpers.mjs";

const desktop = resolve(import.meta.dirname, "../../desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { createServer } = await import(requireDesktop.resolve("vite"));
const renderer = join(desktop, "src/renderer");
const name = `__agent-board-workflow-${process.pid}`;
const html = join(renderer, name + ".html");
const moduleFile = join(renderer, name + ".tsx");
const artifacts = await mkdtemp(join(tmpdir(), "zcode-settings-workflow-"));
let browser, server, page;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    agentBoardFixture
      .replace("function Fixture(){", agentBoardWorkflowFixture + "\nfunction BoardFixture(){")
      .replace("<Fixture/>", "<WorkflowFixture/>"),
  );
  server = await createServer({
    configFile: join(desktop, "vite.config.ts"),
    root: renderer,
    server: { host: "127.0.0.1", port: 19750, strictPort: false },
    optimizeDeps: { entries: [html] },
    logLevel: "warn",
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/v4/SessionPane.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export function SessionPane(props){const R=window.__React;return R.createElement('div',{'data-testid':'board-workflow-session','data-session':props.sessionId??props.acpBoundSessionId,'data-readonly':String(!!props.readOnly)},'Conversation composer')}`,
    }),
  );
  await page.route("**/v4/V4ConversationContext.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export function V4PaneConversationProvider({children}){return children} export function useHasV4Conversation(){return false} export function useV4Conversation(){throw Error('Synthetic conversation boundary')}",
    }),
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}.html`);
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByTestId("task-workflows-settings").waitFor();
  await page.getByText("任务与工作流", { exact: true }).waitFor();
  const defaultRow = await assertBuiltinWorkflow(page, artifacts);
  await page.evaluate(() => window.__board.setTheme("zai-light"));
  await page.getByTestId("workflow-new").click();
  await page.getByTestId("workflow-step").first().waitFor();
  const editor = page.getByTestId("task-workflow-editor");
  const steps = editor.getByTestId("workflow-step");
  assert.equal(await steps.count(), 7);
  assert.match(await steps.nth(1).textContent(), /待办.*起始/);
  assert.equal(await steps.nth(1).getAttribute("aria-pressed"), "true");
  await editor.getByRole("textbox", { name: "工作流名称", exact: true }).fill("研发流程");
  await editor
    .getByRole("textbox", { name: "工作流描述", exact: true })
    .fill("从任务待办、智能体执行到人工验收的交接流程");
  for (const width of [1500, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth));
    const columns = await editor.getByTestId("workflow-editor-columns").evaluate((el) => {
      const [l, r] = el.children;
      const a = l.getBoundingClientRect(),
        b = r.getBoundingClientRect();
      return { sideBySide: b.left >= a.right, stacked: b.top >= a.bottom };
    });
    assert.ok(width === 1500 ? columns.sideBySide : columns.stacked);
    await page.screenshot({
      path: join(artifacts, `workflow-settings-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.evaluate(() => window.__board.setTheme("zai-dark"));
  await page.screenshot({
    path: join(artifacts, "workflow-settings-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => window.__board.setTheme("zai-light"));
  await editor.getByRole("switch", { name: "包含「待规划」" }).click();
  await steps.nth(2).click();
  await editor.getByRole("button", { name: "步骤下移", exact: true }).click();
  assert.match(await steps.nth(3).textContent(), /进行中/);
  await editor.getByRole("button", { name: "步骤上移", exact: true }).click();
  await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
  await editor.getByRole("textbox", { name: "状态名称", exact: true }).fill("安全检查");
  assert.equal(await steps.count(), 8);
  await editor.getByRole("button", { name: "删除步骤", exact: true }).click();
  assert.equal(await steps.count(), 7);
  await steps.nth(2).click();
  await editor.getByRole("radio", { name: "交给智能体", exact: true }).click();
  await editor.getByTestId("work-task-model").click();
  await page.getByTestId("chat-model-select-item-acp:codex").click();
  await editor
    .getByRole("textbox", { name: "阶段要求", exact: true })
    .fill("实现功能，运行验证，等待人工交接");
  await steps.nth(3).click();
  await editor.getByRole("radio", { name: "交给成员", exact: true }).click();
  await editor.getByRole("textbox", { name: "负责人名称", exact: true }).fill("评审人");
  await editor.getByTestId("workflow-save").click();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("button", { name: /研发流程.*6 个步骤/ }).waitFor();
  assert.equal(await page.evaluate(() => window.__board.workRows.length), 0);
  assert.deepEqual(await page.evaluate(() => window.__board.commands.map((r) => r.kind)), [
    "workflow-definition-save",
  ]);
  await page.getByRole("button", { name: /^研发流程/ }).click();
  await editor.waitFor();
  assert.equal(
    await editor.getByRole("textbox", { name: "工作流名称", exact: true }).inputValue(),
    "研发流程",
  );
  await steps.nth(3).click();
  assert.equal(
    await editor.getByRole("textbox", { name: "负责人名称", exact: true }).inputValue(),
    "评审人",
  );
  // A stale Host write must keep the entered draft visible.
  await editor
    .getByRole("textbox", { name: "工作流描述", exact: true })
    .fill("保留未保存的编辑内容");
  await page.evaluate(() => {
    window.__board.rejectWorkflowSave = true;
  });
  await editor.getByTestId("workflow-save").click();
  await editor.getByRole("alert").waitFor();
  assert.equal(
    await editor.getByRole("textbox", { name: "工作流描述", exact: true }).inputValue(),
    "保留未保存的编辑内容",
  );
  assert.equal(
    await editor.getByRole("textbox", { name: "工作流名称", exact: true }).inputValue(),
    "研发流程",
  );
  await page.evaluate(() => {
    window.__board.rejectWorkflowSave = false;
  });
  await editor.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("button", { name: "为项目选择工作流", exact: true }).click();
  const projects = page.getByTestId("settings-projects");
  await projects.waitFor();
  const projectGroup = projects
    .getByTestId("project-group")
    .filter({ hasText: "/fixture/project-3" });
  await projectGroup.waitFor();
  assert.equal(await projects.getByTestId("project-group").count(), 2);
  assert.equal(await projects.getByTestId("project-worktree-row").count(), 0);
  assert.equal(await projects.getByText("/fixture/project-linked", { exact: true }).count(), 0);
  assert.equal(
    await projectGroup.getByRole("combobox", { name: "项目工作流", exact: true }).count(),
    1,
  );
  await projects.getByRole("textbox", { name: "搜索项目", exact: true }).fill("project-linked");
  assert.equal(await projects.getByTestId("project-group").count(), 0);
  await projects.getByText("没有匹配的项目", { exact: true }).waitFor();
  assert.equal(await projects.getByRole("button", { name: "选择搜索结果" }).isDisabled(), true);
  await projects.getByRole("textbox", { name: "搜索项目", exact: true }).fill("");
  await projects.getByRole("button", { name: "选择搜索结果" }).click();
  await projects.getByRole("button", { name: "移除所选（2）" }).waitFor();
  const project = projects.getByText("/fixture/project-3", { exact: true }).locator("../..");
  await project.getByRole("combobox", { name: "项目工作流", exact: true }).click();
  await page.getByRole("option", { name: "研发流程", exact: true }).click();
  await project
    .getByRole("combobox", { name: "项目工作流", exact: true })
    .getByText("研发流程", { exact: true })
    .waitFor();
  await assertDefaultProjectSelection(page, project);
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("list", { name: "研发流程", exact: true }).waitFor();
  assert.deepEqual(
    await page.getByRole("list", { name: "研发流程", exact: true }).locator("li").allTextContents(),
    ["待办", "进行中", "审核中", "已阻塞", "已完成", "已取消"],
  );
  await page.getByRole("button", { name: "删除「研发流程」", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "删除「研发流程」", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => window.__board.showBoard());
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  assert.equal(await page.getByTestId("agent-board-configure-workflow").count(), 0);
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索项目名称或路径…", exact: true }).fill("Project 3");
  await page.getByRole("button", { name: /Project 3.*project-3/ }).click();
  await page.evaluate(() =>
    window.__board.update(3, {
      status: "completed",
      liveStatus: "completed",
      sourceAvailability: "offline",
    }),
  );
  const ordinaryCard = page.locator("[data-board-card]").filter({ hasText: "Implement project 3" });
  await ordinaryCard.getByRole("button").first().click();
  const conversationWorkflow = page.getByTestId("conversation-workflow");
  await conversationWorkflow.getByTestId("conversation-workflow-attach").click();
  await conversationWorkflow.getByTestId("conversation-workflow-status").click();
  await page.getByRole("option", { name: "进行中", exact: true }).click();
  await page.getByTestId("conversation-workflow-transition").waitFor();
  await page
    .getByTestId("conversation-workflow-transition")
    .getByRole("textbox")
    .fill("开始处理这个会话");
  await page.getByTestId("conversation-workflow-confirm").click();
  await page.getByTestId("conversation-workflow-transition").waitFor({ state: "detached" });
  await ordinaryCard
    .locator("[data-board-workflow-stage]")
    .getByText("进行中", { exact: true })
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      runtime: window.__board.native[3].liveStatus,
      workTasks: window.__board.workRows.length,
      workflow: (() => {
        const state = [...window.__conversationWorkflows.values()][0].state;
        const entry = state.history[0];
        return {
          currentStageId: state.currentStageId,
          revision: state.revision,
          history: {
            stageName: entry.stageName,
            targetStageId: entry.targetStageId,
            handoffNote: entry.handoffNote,
          },
        };
      })(),
      mutations: window.__conversationCommands.map((command) => command.operation),
    })),
    {
      runtime: "completed",
      workTasks: 0,
      workflow: {
        currentStageId: "active",
        revision: 2,
        history: {
          stageName: "待办",
          targetStageId: "active",
          handoffNote: "开始处理这个会话",
        },
      },
      mutations: ["attach", "transition"],
    },
  );
  await conversationWorkflow.getByRole("button", { name: "阶段历史" }).click();
  const conversationHistory = page.getByTestId("conversation-workflow-history");
  await conversationHistory.getByText("待办", { exact: false }).waitFor();
  await conversationHistory.getByText("开始处理这个会话", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await conversationHistory.waitFor({ state: "detached" });
  await page.screenshot({
    path: join(artifacts, "conversation-workflow-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await conversationWorkflow.evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  );
  await page.screenshot({
    path: join(artifacts, "conversation-workflow-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByTestId("agent-board-header-actions").locator("button").first().click();
  await page.getByTestId("agent-board-details").waitFor({ state: "detached" });
  await page.getByTestId("agent-board-new-session").click();
  const create = page.getByTestId("work-task-editor");
  await create.getByTestId("work-task-initial-stage").waitFor();
  assert.match(await create.getByTestId("work-task-initial-stage").textContent(), /待办/);
  await create.getByTestId("work-task-editor-project").click();
  await page.getByRole("option", { name: "Project 4", exact: true }).click();
  const native = page.getByTestId("agent-board-session-editor");
  await native.getByTestId("board-workflow-session").waitFor();
  await native.getByTestId("agent-board-session-project").click();
  await page.getByRole("option", { name: "Project 3", exact: true }).click();
  await create.getByTestId("work-task-initial-stage").waitFor();
  await create.getByTestId("work-task-prompt").fill("工作流验收任务");
  await create.getByTestId("work-task-save").click();
  await create.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "工作流验收任务", exact: true }).waitFor();
  await page
    .getByRole("button", { name: /工作流验收任务/ })
    .first()
    .click();
  const content = page.getByTestId("work-task-content");
  await content.getByTestId("workflow-status-select").click();
  assert.equal(await page.getByRole("option", { name: "待规划", exact: true }).count(), 0);
  await page.getByRole("option", { name: "进行中", exact: true }).click();
  await page.getByRole("button", { name: "交接并开始", exact: true }).click();
  await page.getByTestId("workflow-handoff").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__board.workRows[0].execution.kind), "acp");
  await page.evaluate(() => {
    const f = window.__board;
    Object.assign(f.workRows[0], {
      status: "review",
      runSeq: 1,
      session: { kind: "acp", id: "build-session" },
      worktree: {
        rootPath: "/trees",
        path: "/trees/board",
        projectPath: "/fixture/project-3",
        branchName: "task/board",
        baseCommit: "base",
      },
    });
    f.notifyWork();
  });
  await content.getByTestId("workflow-status-select").click();
  await page.getByRole("option", { name: "审核中", exact: true }).click();
  await page.getByRole("button", { name: "确认变更状态", exact: true }).click();
  await page.getByTestId("workflow-handoff").waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() => {
      const t = window.__board.workRows[0];
      return { owner: t.workflow.owner, status: t.status, session: t.session.id };
    }),
    { owner: "评审人", status: "review", session: "build-session" },
  );
  await content.getByRole("button", { name: "阶段历史", exact: true }).click();
  const history = page.getByTestId("workflow-history");
  await history.getByRole("button", { name: /进行中/ }).click();
  const oldSession = history.getByTestId("board-workflow-session");
  await oldSession.waitFor();
  assert.equal(await oldSession.getAttribute("data-session"), "build-session");
  assert.equal(await oldSession.getAttribute("data-readonly"), "true");
  assert.equal(
    await page.evaluate(
      () =>
        window.__board.commands.filter((r) => ["work-task-complete", "merge"].includes(r.kind))
          .length,
    ),
    0,
  );
  await page.keyboard.press("Escape");
  await history.waitFor({ state: "detached" });
  await page.evaluate(() => window.__board.showSettings());
  await page.getByTestId("task-workflows-settings").waitFor();
  await page.getByRole("button", { name: "为项目选择工作流", exact: true }).click();
  await project.getByRole("combobox", { name: "项目工作流", exact: true }).click();
  await page.getByRole("option", { name: "默认工作流", exact: true }).click();
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("button", { name: "删除「研发流程」", exact: true }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await defaultRow.waitFor();
  assert.equal(await page.getByTestId("workflow-stage-preview").count(), 1);
  assert.equal(await page.getByText("尚未创建工作流", { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => window.__board.workRows[0].workflow.definition.name),
    "研发流程",
    "deletion retains an existing task's snapshot",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: Settings navigation, two-column workflow library, optional steps/reorder/add/delete, CAS draft retention, project assignment, actual Board creation and API/ACP/passive handoff/history. Screenshots: ${artifacts}`,
  );
} catch (error) {
  console.error(`Workflow E2E artifacts: ${artifacts}`);
  if (page) {
    await page.screenshot({
      path: join(artifacts, "failure.png"),
      fullPage: true,
      animations: "disabled",
    });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
