import assert from "node:assert/strict";

export async function exerciseAgentBoardWorkflow(page) {
  await page.getByRole("button", { name: "配置工作流", exact: true }).click();
  assert.equal(await page.locator("[data-board-column]").count(), 6);
  await page.getByRole("textbox", { name: "新状态名称", exact: true }).fill("发布");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const publishColumn = page
    .locator('[data-board-column^="workflow:"]')
    .filter({ has: page.getByText("发布", { exact: true }) });
  await publishColumn.waitFor();
  assert.equal(await page.locator("[data-board-column]").count(), 7);

  const card = page.locator("[data-board-card]").first();
  const itemKey = await card.getAttribute("data-board-card");
  await card.getByRole("button", { name: "拖动到工作流状态", exact: true }).dragTo(publishColumn);
  await page.waitForFunction((key) => {
    const saved = JSON.parse(localStorage.getItem("zcode-agent-board:v1"));
    return (
      saved.workflowAssignments[key] ===
        saved.workflowStatuses.find((status) => status.label === "发布")?.id &&
      saved.workflowAssignees[key] === null
    );
  }, itemKey);
  assert.equal(await publishColumn.locator("[data-board-card]").count(), 1);
  const statusId = await page.evaluate((key) => {
    return JSON.parse(localStorage.getItem("zcode-agent-board:v1")).workflowAssignments[key];
  }, itemKey);
  await page.reload();
  await page.waitForFunction(
    ({ key, id }) => {
      return window.__board.store.getState().workflowAssignments[key] === id;
    },
    { key: itemKey, id: statusId },
  );
  assert.equal(await page.evaluate(() => window.__board.store.getState().group), "workflow");
}
