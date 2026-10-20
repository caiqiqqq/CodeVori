import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskComposer(page, artifacts) {
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  const prompt = editor.getByTestId("work-task-prompt");
  await panel.getByTestId("work-task-board").waitFor();
  await panel.getByTestId("work-task-project").click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  await page.evaluate(() => {
    const codex = window.__tasks.catalog.find((entry) => entry.agent === "codex");
    codex.configOptions.find((option) => option.id === "fast").category = "model_config";
    codex.configOptions.push(
      ...["mode", "collaboration_mode"].map((category) => ({
        id: category,
        name: category,
        category,
        type: "select",
        currentValue: "default",
        options: [{ value: "default", name: "Default" }],
      })),
    );
    codex.configOptions.push(
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `extra-${index}`,
        name: `A very long custom configuration name ${index}`,
        type: "boolean",
        currentValue: false,
      })),
    );
  });
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      for (const kind of ["api", "acp"]) {
        await panel.getByTestId("work-task-new").click();
        await editor.getByTestId("work-task-model").click();
        for (const agent of ["codex", "claude"]) {
          assert.ok(
            await page
              .getByTestId(`chat-model-select-item-acp:${agent}`)
              .locator(`[data-acp-agent-icon="${agent}"]`)
              .isVisible(),
          );
        }
        await page
          .getByTestId(`chat-model-select-item-${kind === "api" ? "api" : "acp:codex"}`)
          .click();
        if (width === 1280 && kind === "api") {
          await prompt.fill("Draft scoped to the original project");
          await editor.getByTestId("work-task-editor-project").click();
          await page.getByRole("option", { name: "Other", exact: true }).click();
          await editor.getByText("/synthetic/other", { exact: true }).waitFor();
          assert.equal((await prompt.innerText()).trim(), "");
          assert.match(
            await editor.getByTestId("work-task-api-model").getAttribute("aria-label"),
            /TestModel/,
          );
        }
        await prompt.fill("Independent task draft");
        await prompt.press("End");
        await prompt.press("Enter");
        await page.keyboard.insertText("Second line");
        assert.match(await prompt.innerText(), /Independent task draft\nSecond line/);
        assert.equal(await editor.locator("form").count(), 1);
        const toolbar = editor.locator("[data-composer-leading-actions]");
        const config = editor.getByTestId("work-task-execution-config");
        assert.equal(await toolbar.getByTestId("work-task-model").count(), 0);
        assert.equal(
          await editor
            .locator("[data-composer-trailing-actions]")
            .getByTestId("work-task-model")
            .count(),
          1,
        );
        assert.equal(await toolbar.getByTestId("work-task-execution-config").count(), 1);
        assert.equal(await config.locator("h3").count(), 0);
        assert.equal(await editor.getByTestId("work-task-add-menu").count(), 1);
        if (kind === "api") {
          const mode = config.getByRole("combobox", { name: /^权限模式:/ });
          await assertIconControl(mode, "svg");
          await mode.focus();
          await mode.press("ArrowDown");
          await page.getByRole("option").nth(2).click();
          assert.match(await mode.getAttribute("aria-label"), /规划/);
          const reasoning = config.getByRole("combobox", { name: /^思考强度:/ });
          await assertIconControl(reasoning, ".lucide-brain");
          await reasoning.click();
          await page.getByRole("option", { name: "low", exact: true }).click();
          assert.match(await reasoning.getAttribute("aria-label"), /low/);
        } else {
          assert.ok(
            await editor
              .getByTestId("work-task-model")
              .locator('[data-acp-agent-icon="codex"]')
              .isVisible(),
          );
          assert.equal(await config.getByTestId("acp-composer-config-controls").count(), 1);
          for (const id of [
            "mode",
            "collaboration_mode",
            "model",
            "reasoning",
            "fast",
            "extra-4",
          ]) {
            await assertIconControl(config.getByTestId(`acp-config-trigger-${id}`), null);
          }
          await config.getByTestId("acp-config-trigger-extra-4").click();
          await page.getByTestId("acp-config-choice-extra-4-true").click();
          assert.doesNotMatch(
            await config.getByTestId("acp-config-trigger-extra-4").getAttribute("aria-label"),
            /智能体默认配置/,
          );
          await config.getByTestId("acp-config-trigger-extra-4").click();
          await page.getByTestId("acp-config-default-extra-4").click();
          assert.match(
            await config.getByTestId("acp-config-trigger-extra-4").getAttribute("aria-label"),
            /智能体默认配置/,
          );
        }
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
        assert.ok(
          await config.evaluate((element) => {
            const bounds = element
              .closest("[data-composer-leading-actions]")
              .getBoundingClientRect();
            return (
              element.closest("[data-composer-leading-actions]").scrollWidth <=
                element.closest("[data-composer-leading-actions]").clientWidth + 1 &&
              [...element.querySelectorAll('button, [role="combobox"]')].every((control) => {
                const rect = control.getBoundingClientRect();
                return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right + 1;
              })
            );
          }),
          `${theme}/${width}/${kind}: all execution controls fit inside the configuration region`,
        );
        assert.ok(
          await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        );
        assert.deepEqual(
          await page.evaluate(() =>
            window.__tasks.calls.filter((call) =>
              /^(create|update|start|acp-(create|prompt|refresh|setConfigOption|setGoal|manageAgent|updateAgent))$/.test(
                call.op,
              ),
            ),
          ),
          [],
          "typing, choosing configuration and resizing must not write tasks or call an Agent",
        );
        await page.screenshot({ path: join(artifacts, `composer-${theme}-${width}-${kind}.png`) });
        await editor.getByRole("button", { name: "取消", exact: true }).click();
        await editor.waitFor({ state: "detached" });
      }
    }
  }
  await page.evaluate(() => {
    const codex = window.__tasks.catalog.find((entry) => entry.agent === "codex");
    codex.configOptions = codex.configOptions.filter((option) => !option.id.startsWith("extra-"));
    window.__tasks.publishConfig();
  });
  for (const [theme, width] of [
    ["zai-light", 1280],
    ["zai-dark", 390],
  ]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    await panel.getByTestId("work-task-new").click();
    await editor.getByTestId("work-task-model").click();
    await page.getByTestId("chat-model-select-item-acp:codex").click();
    await prompt.fill("任务描述与智能体配置统一管理");
    await editor.screenshot({
      path: join(artifacts, `task-icons-${theme}-${width}.png`),
      animations: "disabled",
    });
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  }
}

async function assertIconControl(control, icon) {
  if (icon)
    assert.ok(await control.locator(icon).first().isVisible(), "configuration icon is visible");
  assert.equal((await control.innerText()).trim(), "", "configuration is icon-only");
  assert.ok(await control.locator("svg").first().isVisible());
  const label = await control.getAttribute("aria-label");
  assert.match(label, /.+: .+/);
}
