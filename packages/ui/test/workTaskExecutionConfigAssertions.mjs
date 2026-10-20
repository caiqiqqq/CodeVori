import assert from "node:assert/strict";
import { join } from "node:path";

export async function selectWorkTaskExecution(page, editor, value) {
  await editor.getByTestId("work-task-model").click();
  if (value.startsWith("acp:")) {
    await page.getByTestId(`chat-model-select-item-${value}`).click();
  } else {
    await page.getByTestId("chat-model-select-item-api").click();
    await editor.getByTestId("work-task-api-model").click();
    await page
      .getByTestId(`chat-model-select-group-registry-provider:${value.split(":")[1]}`)
      .hover();
    await page.getByTestId(`chat-model-select-item-${value}`).click();
  }
}

export async function exerciseWorkTaskExecutionConfig(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  await page.evaluate(() => {
    const codex = window.__tasks.catalog.find((entry) => entry.agent === "codex");
    codex.configOptions.find((option) => option.id === "fast").category = "model_config";
    codex.configOptions.push(
      {
        id: "permission",
        name: "Permissions",
        category: "mode",
        type: "select",
        currentValue: "ask",
        options: [
          { value: "ask", name: "Ask" },
          { value: "full", name: "Full access" },
        ],
      },
      {
        id: "collaboration",
        name: "Collaboration mode",
        category: "collaboration_mode",
        type: "select",
        currentValue: "execute",
        options: [
          { value: "execute", name: "Execute" },
          { value: "plan", name: "Plan" },
        ],
      },
    );
  });
  await panel.getByTestId("work-task-new").click();
  await editor.getByTestId("work-task-prompt").fill("Synthetic explicit execution configuration");
  const choice = async (id, value) => {
    await editor.getByTestId(`acp-config-trigger-${id}`).click();
    await page.getByTestId(`acp-config-choice-${id}-${value}`).click();
  };
  await selectWorkTaskExecution(page, editor, "acp:codex");
  assert.deepEqual(
    await editor
      .getByTestId("acp-composer-config-controls")
      .locator("button[data-testid]")
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.testid)),
    ["permission", "collaboration", "model", "reasoning", "fast"].map(
      (id) => `acp-config-trigger-${id}`,
    ),
    "icon order follows the message composer",
  );
  assert.equal(
    await editor.locator("[data-composer-trailing-actions]").getByTestId("work-task-model").count(),
    1,
  );
  await choice("model", "codex-model");
  await choice("reasoning", "low");
  await choice("permission", "full");
  await choice("collaboration", "plan");
  for (const id of ["model", "reasoning", "permission", "collaboration"]) {
    const trigger = editor.getByTestId(`acp-config-trigger-${id}`);
    assert.equal(
      (await trigger.innerText()).trim(),
      "",
      "configuration uses the shared icon toolbar",
    );
    assert.ok(await trigger.locator("svg").first().isVisible());
    assert.match(await trigger.getAttribute("aria-label"), /.+: .+/);
    assert.equal(
      await editor
        .locator("[data-composer-leading-actions]")
        .getByTestId(`acp-config-trigger-${id}`)
        .count(),
      1,
      "execution configuration belongs to the shared composer toolbar",
    );
  }
  await selectWorkTaskExecution(page, editor, "acp:claude");
  await choice("mode", "plan");
  await selectWorkTaskExecution(page, editor, "custom:api:TestModel");
  await editor.getByRole("combobox", { name: /^权限模式:/ }).click();
  await page.getByRole("option", { name: "规划", exact: true }).click();
  await editor.getByRole("combobox", { name: /^思考强度:/ }).click();
  await page.getByRole("option", { name: "low", exact: true }).click();
  await selectWorkTaskExecution(page, editor, "acp:codex");
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /CodexModel/,
  );
  assert.match(
    await editor.getByTestId("acp-config-trigger-permission").getAttribute("aria-label"),
    /Full access/,
  );
  assert.match(
    await editor.getByTestId("acp-config-trigger-collaboration").getAttribute("aria-label"),
    /Plan/,
  );
  await page.evaluate(() => window.__tasks.publishConfig());
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /CodexModel/,
  );

  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        assert.equal(await editor.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        await page.screenshot({
          path: join(artifacts, `execution-config-${locale}-${theme}-${width}.png`),
        });
      }
    }
  }
  await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  const saved = await page.evaluate(() => window.__tasks.tasks.at(-1));
  assert.equal(saved.status, "todo");
  assert.equal(saved.execution.agent, "codex");
  assert.deepEqual(saved.execution.config, [
    { configId: "model", value: "codex-model" },
    { configId: "reasoning", value: "low" },
    { configId: "permission", value: "full" },
    { configId: "collaboration", value: "plan" },
  ]);
  await panel.getByTestId("work-task-new").click();
  await selectWorkTaskExecution(page, editor, "custom:api:TestModel");
  await editor.getByTestId("work-task-prompt").fill("Synthetic API configuration");
  await editor.getByRole("combobox", { name: /^权限模式:/ }).click();
  await page.getByRole("option", { name: "规划", exact: true }).click();
  await editor.getByRole("combobox", { name: /^思考强度:/ }).click();
  await page.getByRole("option", { name: "low", exact: true }).click();
  await selectWorkTaskExecution(page, editor, "acp:claude");
  await editor.getByTestId("work-task-model").click();
  await page.getByTestId("chat-model-select-item-api").click();
  assert.match(
    await editor.getByRole("combobox", { name: /^权限模式:/ }).getAttribute("aria-label"),
    /规划/,
  );
  assert.match(
    await editor.getByRole("combobox", { name: /^思考强度:/ }).getAttribute("aria-label"),
    /low/,
  );
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.__tasks.tasks.at(-1).execution), {
    kind: "api",
    mode: "plan",
    modelSelection: { providerId: "api", modelId: "TestModel", options: { reasoningLevel: "low" } },
  });
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^(start|startAll|acp-(create|prompt|refresh|setConfigOption|manageAgent|updateAgent))$/.test(
          call.op,
        ),
      ),
    ),
    false,
  );
}
