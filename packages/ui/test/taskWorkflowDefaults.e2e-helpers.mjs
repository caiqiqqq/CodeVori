import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertBuiltinWorkflow(page, artifacts) {
  const defaultRow = page.getByRole("button", { name: /^默认工作流/ });
  await defaultRow.waitFor();
  assert.equal(await page.getByTestId("workflow-stage-preview").count(), 1);
  assert.equal(await page.getByRole("button", { name: "删除「默认工作流」" }).count(), 0);
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((value) => window.__board.setTheme(value), theme);
    for (const width of [1500, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await defaultRow.click();
      const builtin = page.getByTestId("builtin-task-workflow");
      await builtin.waitFor();
      assert.equal(await builtin.locator("ol li").count(), 7);
      assert.ok(await builtin.evaluate((el) => el.scrollWidth <= el.clientWidth));
      assert.equal(await page.getByTestId("workflow-save").count(), 0);
      await builtin.getByRole("button", { name: "工作流", exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.screenshot({
    path: join(artifacts, "default-workflow-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(await page.evaluate(() => window.__board.commands), []);
  return defaultRow;
}

export async function assertDefaultProjectSelection(page, project) {
  await project.getByRole("combobox", { name: "项目工作流", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: "默认工作流", exact: true }).count(), 1);
  await page.getByRole("option", { name: "默认工作流", exact: true }).click();
  await project
    .getByRole("combobox", { name: "项目工作流", exact: true })
    .getByText("默认工作流", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.__board.commands.filter((row) => row.kind === "workflow-select").at(-1).workflowId,
    ),
    null,
  );
  await project.getByRole("combobox", { name: "项目工作流", exact: true }).click();
  await page.getByRole("option", { name: "研发流程", exact: true }).click();
  await project
    .getByRole("combobox", { name: "项目工作流", exact: true })
    .getByText("研发流程", { exact: true })
    .waitFor();
}
