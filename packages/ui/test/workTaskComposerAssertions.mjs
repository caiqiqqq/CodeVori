import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskComposer(page, artifacts) {
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  const prompt = editor.getByTestId("work-task-prompt");
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(() => {
    const codex = window.__tasks.catalog.find((entry) => entry.agent === "codex");
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
        if (kind === "api")
          await page.getByTestId("chat-model-select-group-registry-provider:api").hover();
        await page
          .getByTestId(
            `chat-model-select-item-${kind === "api" ? "custom:api:TestModel" : "acp:codex"}`,
          )
          .click();
        await prompt.fill("Independent task draft");
        await prompt.press("End");
        await prompt.press("Enter");
        await page.keyboard.insertText("Second line");
        assert.match(await prompt.innerText(), /Independent task draft\nSecond line/);
        assert.equal(await editor.locator("form").count(), 1);
        const toolbar = editor.locator("[data-composer-leading-actions]");
        assert.equal(await toolbar.getByTestId("work-task-model").count(), 1);
        assert.equal(await toolbar.getByTestId("work-task-add-menu").count(), 1);
        if (kind === "api") {
          assert.equal(
            await toolbar.getByRole("combobox", { name: "权限模式", exact: true }).count(),
            1,
          );
          const reasoning = toolbar.getByRole("combobox", { name: "思考强度", exact: true });
          await reasoning.click();
          await page.getByRole("option", { name: "low", exact: true }).click();
        } else {
          assert.equal(await toolbar.getByTestId("acp-composer-config-controls").count(), 1);
          await toolbar.getByTestId("acp-config-trigger-extra-4").click();
          await page.getByTestId("acp-config-choice-extra-4-true").click();
          assert.doesNotMatch(
            await toolbar.getByTestId("acp-config-trigger-extra-4").innerText(),
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
        const model = await toolbar.getByTestId("work-task-model").boundingBox();
        const add = await toolbar.getByTestId("work-task-add-menu").boundingBox();
        assert.ok(
          Math.abs(model.y + model.height / 2 - add.y - add.height / 2) < 2,
          "add and model controls share the first toolbar row",
        );
        assert.ok(
          await toolbar.evaluate((element) => {
            const shell = element.parentElement.parentElement;
            const bounds = shell.getBoundingClientRect();
            return (
              shell.scrollWidth <= shell.clientWidth + 1 &&
              [...element.querySelectorAll('button, [role="combobox"]')].every((control) => {
                const rect = control.getBoundingClientRect();
                return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right + 1;
              })
            );
          }),
          `${theme}/${width}/${kind}: all composer controls fit inside the input shell`,
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
}
