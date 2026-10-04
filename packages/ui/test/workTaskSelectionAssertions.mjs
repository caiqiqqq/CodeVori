import assert from "node:assert/strict";
import { assertWorkTaskSessionTarget } from "./workTaskWorkbenchLayoutAssertions.mjs";
import {
  assertWorkTaskPendingChat,
  exerciseWorkTaskPendingChatLayout,
} from "./workTaskChatPresentationAssertions.mjs";

const writes = (page) =>
  page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list"));

export async function assertWorkTaskCompactToolbar(panel) {
  await panel.getByRole("heading", { name: "待办任务", exact: true }).waitFor();
  assert.equal(await panel.getByTestId("work-task-project").count(), 1);
  assert.equal(await panel.getByRole("combobox", { name: "状态筛选", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("textbox", { name: "搜索任务", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "刷新", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("checkbox", { name: "显示归档", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("checkbox", { name: "显示已取消", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("spinbutton", { name: "项目并发", exact: true }).count(), 0);
  const actions = panel.getByTestId("work-task-actions");
  await actions.waitFor();
  assert.equal(await actions.getByRole("button").count(), 2);
  assert.equal(await actions.getByRole("button", { name: "全部开始", exact: true }).count(), 1);
  assert.equal(await actions.getByRole("button", { name: "新建任务", exact: true }).count(), 1);
  assert.equal(await panel.getByText("请先打开并选择一个 Git 项目。", { exact: true }).count(), 0);
  const header = await panel.getByTestId("work-task-sidebar").locator("header").boundingBox();
  const controls = await actions.boundingBox();
  const board = await panel.getByTestId("work-task-board").boundingBox();
  assert.ok(Math.abs(controls.y - header.y - header.height) < 1, "actions must follow the header");
  assert.ok(Math.abs(board.y - controls.y - controls.height) < 1, "board must follow the actions");
}

export async function exerciseWorkTaskSelection(page, panel, card, cardAction, artifacts) {
  await page.evaluate(() => {
    window.__tasks.deferPreparation = true;
  });
  await panel.getByTestId("work-task-start-all").click();
  await card("task-0").locator('[data-work-task-status="preparing"]').waitFor();
  await card("task-1").locator('[data-work-task-status="preparing"]').waitFor();
  assert.ok(await panel.getByTestId("work-task-start-all").isDisabled());
  const beforeSelection = await writes(page);
  // 点击卡片中心和状态位置，不能仅覆盖原来已经能用的标题按钮。
  await card("task-0").click();
  assert.equal(await card("task-0").getAttribute("data-selected"), "true");
  await panel.getByTestId("work-task-preparing").waitFor();
  await assertWorkTaskPendingChat(panel, {
    text: "Edited API instructions",
    modelValue: "custom:api:TestModel",
  });
  const statusElement = card("task-1").locator('[data-work-task-status="preparing"]');
  await statusElement.scrollIntoViewIfNeeded();
  const status = await statusElement.boundingBox();
  await page.mouse.click(status.x + status.width / 2, status.y + status.height / 2);
  await panel.getByTestId("work-task-preparing").waitFor();
  assert.equal(await card("task-1").getAttribute("data-selected"), "true");
  assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 0);
  await assertWorkTaskPendingChat(panel, {
    text: "Implement an ACP task",
    modelValue: "acp:codex",
  });
  const config = panel.getByTestId("work-task-unstarted");
  assert.ok(await config.getByTestId("acp-config-trigger-reasoning").isDisabled());
  assert.ok(await config.getByTestId("acp-config-trigger-model").isDisabled());
  assert.ok((await config.getByTestId("acp-config-trigger-reasoning").innerText()).includes("low"));
  assert.ok(
    (await config.getByTestId("acp-config-trigger-model").innerText()).includes("codex-model"),
  );
  assert.deepEqual(await writes(page), beforeSelection, "selection must not issue commands");

  await page.evaluate(() => window.__tasks.completePreparation("task-0"));
  await card("task-0").locator('[data-work-task-status="running"]').waitFor();
  assert.equal(await card("task-1").getAttribute("data-selected"), "true");
  assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 0);
  await page.evaluate(() => window.__tasks.failPreparation("task-1"));
  await panel.getByTestId("work-task-unstarted").getByRole("alert").waitFor();
  assert.equal(
    await panel.getByTestId("work-task-unstarted").getByRole("alert").innerText(),
    "Synthetic git preparation failed",
  );
  assert.equal(await card("task-1").getAttribute("data-selected"), "true");
  assert.equal(await panel.getByTestId("work-task-fixture-session").count(), 0);
  assert.deepEqual(await writes(page), beforeSelection);
  await exerciseWorkTaskPendingChatLayout(page, panel, artifacts);

  await cardAction("task-1", "重新开始");
  await panel.getByTestId("work-task-preparing").waitFor();
  await page.evaluate(() => window.__tasks.completePreparation("task-1"));
  await assertWorkTaskSessionTarget(
    panel,
    "acp",
    "session-task-1",
    "/synthetic/trees/task-1/project",
  );
  const beforeMenu = await writes(page);
  await card("task-0").getByRole("button", { name: "任务操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "任务详情", exact: true }).click();
  await page.getByTestId("work-task-detail").waitFor();
  assert.equal(await card("task-1").getAttribute("data-selected"), "true");
  assert.equal(await card("task-0").getAttribute("data-selected"), "false");
  await page.keyboard.press("Escape");
  await page.getByTestId("work-task-detail").waitFor({ state: "detached" });
  await assertWorkTaskSessionTarget(
    panel,
    "acp",
    "session-task-1",
    "/synthetic/trees/task-1/project",
  );
  const apiButton = card("task-0").getByRole("button", { name: "API task", exact: true });
  await apiButton.focus();
  await apiButton.press("Enter");
  await assertWorkTaskSessionTarget(
    panel,
    "api",
    "session-task-0",
    "/synthetic/trees/task-0/project",
  );
  const acpButton = card("task-1").getByRole("button", { name: "ACP task", exact: true });
  await acpButton.focus();
  await acpButton.press("Space");
  await assertWorkTaskSessionTarget(
    panel,
    "acp",
    "session-task-1",
    "/synthetic/trees/task-1/project",
  );
  assert.equal(await panel.locator("button button").count(), 0, "no nested interactive buttons");
  assert.deepEqual(await writes(page), beforeMenu);
  await page.evaluate(() => {
    window.__tasks.deferPreparation = false;
  });
}

export async function exerciseWorkTaskProjectBoundary(page, panel, card) {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(() => window.__tasks.setWorkspace("conversation"));
  await card("task-1").waitFor();
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "Project");
  await panel.getByTestId("work-task-project").click();
  assert.equal(await page.getByRole("option", { name: "Conversation", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__tasks.tasks.push({
      ...window.__tasks.tasks[1],
      workspacePath: "/synthetic/default",
      id: "orphan-task",
      title: "Orphan task",
      status: "failed",
      session: undefined,
      failureReason: "Synthetic old failure",
    });
    window.__tasks.setWorkspace("none");
  });
  await card("orphan-task").waitFor();
  const before = await writes(page);
  assert.ok(await panel.getByTestId("work-task-project").isDisabled());
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "未选择项目");
  await assertWorkTaskCompactToolbar(panel);
  assert.ok(await panel.getByTestId("work-task-new").isDisabled());
  assert.ok(await panel.getByTestId("work-task-start-all").isDisabled());
  await card("orphan-task").click();
  await panel.getByTestId("work-task-unstarted").getByRole("alert").waitFor();
  await card("orphan-task").getByRole("button", { name: "任务操作", exact: true }).click();
  assert.equal(
    await page
      .getByRole("menuitem", { name: "重新开始", exact: true })
      .getAttribute("aria-disabled"),
    "true",
  );
  await page.keyboard.press("Escape");
  await panel.getByRole("button", { name: "任务详情", exact: true }).click();
  const detail = page.getByTestId("work-task-detail");
  await detail.waitFor();
  assert.ok(await detail.getByRole("button", { name: "重新开始", exact: true }).isDisabled());
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "detached" });
  assert.deepEqual(
    await writes(page),
    before,
    "opening old default-directory tasks must not execute",
  );
}
