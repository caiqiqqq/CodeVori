import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskAcpCreation(page, panel, card) {
  const editor = page.getByTestId("work-task-editor");
  await panel.getByTestId("work-task-new").click();

  await editor.getByTestId("work-task-prompt").fill("Implement an ACP task");
  await editor.getByTestId("work-task-model").click();
  await page.getByTestId("chat-model-select-item-acp:codex").waitFor();
  assert.equal(await page.getByTestId("chat-model-select-item-acp:gemini").count(), 0);
  assert.equal(await page.getByTestId("chat-model-select-item-acp:qoder").count(), 0);
  await page.getByTestId("chat-model-select-item-acp:codex").click();
  assert.ok(
    await editor.getByTestId("work-task-model").getByText("Codex ACP", { exact: true }).isVisible(),
    "selected agent must remain visible outside the chat container",
  );
  await editor.getByTestId("acp-config-trigger-reasoning").click();
  await page.getByTestId("acp-config-choice-reasoning-low").click();
  await editor.getByTestId("acp-config-trigger-model").click();
  await page.getByTestId("acp-config-choice-model-codex-model").click();
  await editor.getByTestId("acp-config-trigger-fast").click();
  await page.getByTestId("acp-config-choice-fast-true").click();
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) => ["acp-create", "acp-prompt"].includes(c.op)),
    ),
    false,
  );
  await page.evaluate(() => {
    window.__tasks.failSave = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.equal(await editor.getByTestId("work-task-title").count(), 0);
  assert.equal(await editor.getByTestId("work-task-prompt").innerText(), "Implement an ACP task");
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  await card("task-1").waitFor();
  const saved = await page.evaluate(() => window.__tasks.tasks[1].execution);
  assert.equal(saved.kind, "acp");
  assert.equal(saved.agent, "codex");
  assert.deepEqual(saved.config, [
    { configId: "reasoning", value: "low" },
    { configId: "model", value: "codex-model" },
    { configId: "fast", value: true },
  ]);
}

export async function exerciseWorkTaskAgentConfigSelection(page, panel, artifacts) {
  const originalTheme = await page.evaluate(() => document.documentElement.className);
  const editor = page.getByTestId("work-task-editor");
  const select = async (value) => {
    await editor.getByTestId("work-task-model").click();
    if (value.startsWith("custom:"))
      await page.getByTestId("chat-model-select-group-registry-provider:api").hover();
    await page.getByTestId(`chat-model-select-item-${value}`).click();
  };
  const choice = async (id, value) => {
    await editor.getByTestId(`acp-config-trigger-${id}`).click();
    await page.getByTestId(`acp-config-choice-${id}-${value}`).click();
  };
  await page.evaluate(() => {
    window.__tasks.failConfig = true;
  });
  await panel.getByTestId("work-task-new").click();
  await page.waitForFunction(() => window.__tasks.failConfig === false);
  assert.equal(
    await page.evaluate(() => window.__tasks.agentListeners.size),
    0,
    "a failed/unsupported catalog read must not subscribe to a new Host event",
  );

  await editor.getByTestId("work-task-prompt").fill("Keep this draft without running an agent");
  await select("acp:codex");
  await editor.getByTestId("acp-config-trigger-model").waitFor();
  await page.waitForFunction(() => window.__tasks.agentListeners.size === 1);
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  assert.equal(
    await page.evaluate(() => window.__tasks.calls.some((call) => call.op === "acp-list")),
    false,
    "agent configuration must not depend on the new project's history",
  );
  await choice("model", "codex-model");
  await choice("reasoning", "low");
  await choice("fast", "true");
  await editor.getByTestId("acp-config-trigger-fast").click();
  await page.getByTestId("acp-config-default-fast").click();
  assert.match(
    await editor.getByTestId("acp-config-trigger-fast").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  await page.evaluate(() => window.__tasks.publishConfig());
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /CodexModel/,
  );
  assert.doesNotMatch(
    await editor.getByTestId("acp-config-trigger-reasoning").getAttribute("aria-label"),
    /智能体默认配置/,
  );

  await select("acp:claude");
  assert.equal(await editor.getByTestId("acp-config-trigger-reasoning").count(), 0);
  await choice("mode", "plan");
  assert.doesNotMatch(
    await editor.getByTestId("acp-config-trigger-mode").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  await select("acp:codex");
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  assert.equal(await editor.getByTestId("acp-config-trigger-mode").count(), 0);
  await select("custom:api:TestModel");
  assert.equal(await editor.getByTestId("acp-composer-config-controls").count(), 0);
  assert.ok(await editor.getByRole("combobox", { name: /^权限模式:/ }).isVisible());
  await select("acp:kimi-code");
  await editor.getByTestId("work-task-agent-default").waitFor();
  assert.ok(await editor.getByTestId("work-task-save").isEnabled());

  await select("acp:codex");
  await page.evaluate(() => {
    window.__tasks.failConfig = true;
    window.__tasks.publishConfig();
  });
  await editor.getByRole("alert").waitFor();
  assert.match(await editor.getByRole("alert").innerText(), /Synthetic catalog failed/);
  assert.equal(await editor.getByTestId("work-task-title").count(), 0);
  await editor.getByTestId("work-task-config-retry").click();
  await editor.getByRole("alert").waitFor({ state: "detached" });

  await page.evaluate(() => {
    window.__tasks.delayConfigs = true;
    window.__tasks.publishConfig();
  });
  await page.waitForFunction(() => window.__tasks.pendingConfigs.length === 1);
  await page.evaluate(() => {
    const item = window.__tasks.catalog.find((item) => item.agent === "codex").configOptions[0];
    item.options = [...item.options, { value: "fresh-model", name: "FreshModel" }];
    window.__tasks.publishConfig();
  });
  await editor.getByTestId("acp-config-trigger-model").click();
  await page.getByTestId("acp-config-choice-model-fresh-model").waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__tasks.finishConfig());
  await editor.getByTestId("acp-config-trigger-model").click();
  await page.getByTestId("acp-config-choice-model-fresh-model").waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("menu").waitFor({ state: "detached" });
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((value) => {
      document.documentElement.className =
        value === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 740 });
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
      assert.equal(
        await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
        false,
        "agent controls must not overflow a narrow dialog",
      );
      await page.screenshot({ path: join(artifacts, `agent-config-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate((theme) => {
    document.documentElement.className = theme;
  }, originalTheme);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^acp-(create|prompt|refresh|setConfigOption|manageAgent|updateAgent)$/.test(call.op),
      ),
    ),
    false,
    "all agent editor actions must stay offline",
  );
}

export async function exerciseWorkTaskAgentConfigPersistence(page, panel) {
  const editor = page.getByTestId("work-task-editor");
  const select = async (agent) => {
    await editor.getByTestId("work-task-model").click();
    await page.getByTestId(`chat-model-select-item-acp:${agent}`).click();
  };
  const choice = async (id, value) => {
    await editor.getByTestId(`acp-config-trigger-${id}`).click();
    await page.getByTestId(`acp-config-choice-${id}-${value}`).click();
  };
  const save = async () => {
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
  };
  await panel.getByTestId("work-task-new").click();

  await editor.getByTestId("work-task-prompt").fill("Synthetic default configuration");
  await select("claude");
  await choice("mode", "plan");
  await editor.getByTestId("acp-config-trigger-mode").click();
  await page.getByTestId("acp-config-default-mode").click();
  await save();
  const task = await page.evaluate(() => window.__tasks.tasks.at(-1));
  assert.deepEqual(task.execution, { kind: "acp", agent: "claude", config: [] });
  const card = panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
  const edit = async () => {
    await card.getByRole("button", { name: "任务操作", exact: true }).click();
    await page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "编辑任务", exact: true })
      .click();
    await editor.waitFor();
  };
  await edit();
  assert.match(
    await editor.getByTestId("acp-config-trigger-mode").getAttribute("aria-label"),
    /智能体默认配置/,
  );
  await select("codex");
  await choice("model", "codex-model");
  await choice("fast", "false");
  await select("codex");
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /CodexModel/,
  );
  await save();
  const saved = await page.evaluate(
    (id) => window.__tasks.tasks.find((task) => task.id === id).execution,
    task.id,
  );
  assert.deepEqual(saved.config, [
    { configId: "model", value: "codex-model" },
    { configId: "fast", value: false },
  ]);
  await card.locator('[data-work-task-status="running"]').waitFor();
  await page.evaluate((id) => window.__tasks.status(id, "failed"), task.id);
  await edit();
  await page.evaluate(() => {
    window.__tasks.catalog.find((item) => item.agent === "codex").configOptions[0].currentValue =
      "fresh-model";
    window.__tasks.publishConfig();
  });
  assert.match(
    await editor.getByTestId("acp-config-trigger-model").getAttribute("aria-label"),
    /CodexModel/,
  );
  await editor.getByTestId("acp-config-trigger-fast").click();
  assert.equal(
    await page.getByTestId("acp-config-choice-fast-false").getAttribute("aria-checked"),
    "true",
  );
  await page.getByTestId("acp-config-default-fast").click();
  await save();
  assert.deepEqual(
    await page.evaluate(
      (id) => window.__tasks.tasks.find((task) => task.id === id).execution.config,
      task.id,
    ),
    [{ configId: "model", value: "codex-model" }],
  );
}
