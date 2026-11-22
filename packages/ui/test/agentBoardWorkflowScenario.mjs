import assert from "node:assert/strict";

export async function exerciseAgentBoardWorkflow(page) {
  await page.getByRole("button", { name: "配置工作流", exact: true }).click();
  await page
    .getByText(
      "这里定义看板会话与任务可归入的状态列。状态按生命周期分组；启用项会显示为列，运行状态仍由会话或任务决定。",
      { exact: true },
    )
    .waitFor();
  await page
    .getByText("卡片切换到其他状态后，会清空该卡片的看板负责人。", { exact: true })
    .waitFor();
  for (const category of ["未开始", "已开始", "已完成", "已关闭"])
    await page.getByRole("region", { name: category }).waitFor();
  assert.equal(await page.locator("[data-board-column]").count(), 6);
  await page.getByRole("textbox", { name: "新状态名称", exact: true }).fill("发布");
  await page.getByRole("combobox", { name: "新状态分组", exact: true }).click();
  await page.getByRole("option", { name: "未开始", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const publishColumn = page
    .locator('[data-board-column^="workflow:"]')
    .filter({ has: page.getByText("发布", { exact: true }) });
  await publishColumn.waitFor();
  assert.equal(await page.locator("[data-board-column]").count(), 7);
  const storedStatus = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("zcode-agent-board:v1")).workflowStatuses.find(
      (status) => status.label === "发布",
    ),
  );
  assert.equal(storedStatus.category, "unstarted");
  assert.equal(
    await page.locator("[data-board-column]").nth(1).getAttribute("data-board-column"),
    `workflow:${storedStatus.id}`,
  );
  const savedPreferences = await page.evaluate(() => localStorage.getItem("zcode-agent-board:v1"));
  await page.reload();
  const afterReload = await page.evaluate(() => ({
    statuses: window.__board.store.getState().workflowStatuses,
    columns: [...document.querySelectorAll("[data-board-column]")].map((column) =>
      column.getAttribute("data-board-column"),
    ),
    preferences: localStorage.getItem("zcode-agent-board:v1"),
  }));
  assert.ok(
    afterReload.columns.includes(`workflow:${storedStatus.id}`),
    JSON.stringify({ savedPreferences, afterReload }),
  );
  assert.equal(
    afterReload.statuses.find((status) => status.id === storedStatus.id)?.category,
    "unstarted",
  );
  assert.equal(await page.evaluate(() => window.__board.store.getState().group), "workflow");
}
