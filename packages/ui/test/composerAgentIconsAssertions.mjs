import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseComposerAgentIcons(page, input, artifacts, width) {
  assert.equal(await page.evaluate(() => innerWidth), width);
  const model = page.getByTestId("chat-model-select-trigger");
  const agents = await page.evaluate(() => window.__composerAgents);
  const originalInput = await input.elementHandle();
  for (const theme of ["theme-zai-light", "dark theme-zai-dark"]) {
    await page.evaluate((value) => {
      document.documentElement.className = value;
    }, theme);
    const themeName = theme.startsWith("dark") ? "dark" : "light";
    await model.click();
    await page.getByTestId("chat-model-select-item-acp:codex").waitFor();
    for (const { id, name } of agents) {
      const item = page.getByTestId(`chat-model-select-item-acp:${id}`);
      await item.scrollIntoViewIfNeeded();
      assert.match(await item.innerText(), new RegExp(name));
      const icon = item.locator(`[data-acp-agent-icon="${id}"]`);
      assert.equal(await icon.count(), 1);
      assert.equal(await icon.isVisible(), true, `${name} menu icon must be visible`);
    }
    await page.getByTestId("chat-model-select-item-acp:codex").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `menu-${width}-${themeName}.png`) });
    for (const agent of ["codex", "claude", "gemini", "opencode"]) {
      // Tooltip 与 Dropdown 共用触发器，data-state 会被覆盖；菜单状态以 aria-expanded 为准。
      if ((await model.getAttribute("aria-expanded")) !== "true") await model.click();
      const item = page.getByTestId(`chat-model-select-item-acp:${agent}`);
      // 点击图标本身也必须命中原菜单项，而不是被装饰节点拦截。
      await item.locator(`[data-acp-agent-icon="${agent}"]`).click();
      await page.getByRole("menu").waitFor({ state: "detached" });
      await model.locator(`[data-acp-agent-icon="${agent}"]`).waitFor();
      assert.equal(await model.locator("[data-acp-agent-icon]").count(), 1);
      assert.equal(
        await model.getAttribute("aria-label"),
        agents.find(({ id }) => id === agent).name,
      );
      assert.equal(await model.getAttribute("data-model-current-value"), `acp:${agent}`);
      assert.equal(await input.textContent(), "保留草稿");
      assert.equal(await page.evaluate((element) => element.isConnected, originalInput), true);
      assert.equal(await page.getByTestId("v4-composer-input").count(), 1);
      if (agent === "codex")
        await page.screenshot({ path: join(artifacts, `selected-${width}-${themeName}.png`) });
    }
    await page.evaluate(() => window.__setContextView((view) => ({ ...view, agent: null })));
    await model.locator("[data-acp-agent-icon]").waitFor({ state: "detached" });
    assert.equal(await input.textContent(), "保留草稿");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "Agent icons must not create horizontal overflow",
    );
  }
  await originalInput.dispose();
}
