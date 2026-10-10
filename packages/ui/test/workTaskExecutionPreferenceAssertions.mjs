import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskExecutionPreferences(page, artifacts) {
  // 独立页面只使用 synthetic Host；重载模拟客户端重启，不触碰桌面任务或付费 Agent。
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("zcode-work-task-execution:v1:")) localStorage.removeItem(key);
  });
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  const open = async () => {
    await panel.getByTestId("work-task-new").click();
    await editor.waitFor();
  };
  const close = async () => {
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  };
  const selectAgent = async (agent) => {
    await editor.getByTestId("work-task-model").click();
    await page.getByTestId(`chat-model-select-item-acp:${agent}`).click();
  };
  const choice = async (id, value) => {
    await editor.getByTestId(`acp-config-trigger-${id}`).click();
    await page.getByTestId(`acp-config-choice-${id}-${value}`).click();
  };
  const project = async (name) => {
    await panel.getByTestId("work-task-project").click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const assertCodex = async () => {
    await editor.getByTestId("work-task-model").getByText("Codex ACP", { exact: true }).waitFor();
    assert.match(
      await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
      /CodexModel/,
    );
    assert.doesNotMatch(
      await editor.getByTestId("acp-config-trigger-reasoning").getAttribute("aria-label"),
      /智能体默认配置/,
    );
    for (const [id, value] of [
      ["reasoning", "low"],
      ["fast", "false"],
    ]) {
      await editor.getByTestId(`acp-config-trigger-${id}`).click();
      assert.equal(
        await page.getByTestId(`acp-config-choice-${id}-${value}`).getAttribute("aria-checked"),
        "true",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "detached" });
    }
  };
  await open();
  await selectAgent("codex");
  await choice("model", "codex-model");
  await choice("reasoning", "low");
  await choice("fast", "false");

  await editor.getByTestId("work-task-prompt").fill("Do not remember this prompt");
  await close();
  await open();
  await assertCodex();
  assert.equal(await editor.getByTestId("work-task-title").count(), 0);
  assert.equal((await editor.getByTestId("work-task-prompt").innerText()).trim(), "");
  await close();
  await page.reload();
  await open();
  await assertCodex();
  await editor.getByTestId("acp-config-trigger-fast").click();
  await page.getByTestId("acp-config-default-fast").click();
  await close();
  await open();
  assert.match(
    await editor.getByTestId("acp-config-trigger-fast").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  await editor.getByTestId("work-task-model").getByText("Codex ACP", { exact: true }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.screenshot({ path: join(artifacts, "remembered-task-execution.png") });
  await close();

  const task = await page.evaluate(() =>
    window.__tasks.seed({
      title: "Existing API",
      prompt: "Keep task configuration",
      execution: {
        kind: "api",
        mode: "build",
        modelSelection: {
          providerId: "api",
          modelId: "TestModel",
          options: { reasoningLevel: "high" },
        },
      },
    }),
  );
  const card = panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
  await card.getByRole("button", { name: "任务操作", exact: true }).click();
  await page
    .locator('[role="menu"][data-state="open"]')
    .getByRole("menuitem", { name: "编辑任务", exact: true })
    .click();
  await editor.getByRole("combobox", { name: /^权限模式:/ }).click();
  await page.getByRole("option").nth(2).click();
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__tasks.tasks[0].execution.mode), "plan");
  await open();
  await editor.getByTestId("work-task-model").getByText("Codex ACP", { exact: true }).waitFor();
  await selectAgent("claude");
  await choice("mode", "plan");
  await close();
  await open();
  await editor.getByTestId("work-task-model").getByText("Claude ACP", { exact: true }).waitFor();
  assert.doesNotMatch(
    await editor.getByTestId("acp-config-trigger-mode").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  await close();

  await project("Other");
  await open();
  await editor.getByTestId("work-task-api-model").getByText("TestModel", { exact: true }).waitFor();
  await editor.getByRole("combobox", { name: /^权限模式:/ }).click();
  await page.getByRole("option").nth(3).click();
  await editor.getByRole("combobox", { name: /^思考强度:/ }).click();
  await page.getByRole("option").nth(0).click();
  const rememberedApi = await editor
    .getByRole("combobox", { name: /^权限模式:/ })
    .getAttribute("aria-label");
  const rememberedReasoning = await editor
    .getByRole("combobox", { name: /^思考强度:/ })
    .getAttribute("aria-label");
  await close();
  await page.reload();
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "Other");
  await open();
  await editor.getByTestId("work-task-api-model").getByText("TestModel", { exact: true }).waitFor();
  assert.equal(
    await editor.getByRole("combobox", { name: /^权限模式:/ }).getAttribute("aria-label"),
    rememberedApi,
  );
  assert.equal(
    await editor.getByRole("combobox", { name: /^思考强度:/ }).getAttribute("aria-label"),
    rememberedReasoning,
  );
  await close();
  await project("Project");
  await open();
  await editor.getByTestId("work-task-model").getByText("Claude ACP", { exact: true }).waitFor();
  await close();
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) =>
        /^(create|update|start|startAll|acp-(create|prompt|refresh|setConfigOption|manageAgent|updateAgent))$/.test(
          c.op,
        ),
      ),
    ),
    false,
  );
}
