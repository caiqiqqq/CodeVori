import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseAgentBoardAgentLabels(page, artifacts) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.getByRole("heading", { name: "Agent 看板", exact: true }).waitFor();
  await page.evaluate(() => {
    const f = window.__board;
    const s = f.store.getState();
    s.selectProject(null);
    s.setSearch("");
    s.setAgent("all");
    s.setView("all");
    s.setTracking({
      mode: "all",
      projects: [],
      standalone: false,
      workTasks: false,
      includedItems: [],
      excludedItems: [],
    });
    for (const agent of ["codex", "claude"])
      f.workRows.push({
        workspacePath: "/fixture/project-3",
        id: "label-" + agent,
        title: "Label task " + agent,
        prompt: "Compare labels",
        status: "review",
        execution: { kind: "acp", agent, config: [] },
        archived: false,
        stopPending: false,
        runSeq: 1,
        createdAt: 100,
        updatedAt: 4000,
      });
    f.workRows.push({
      workspacePath: "/fixture/project-3",
      id: "label-api-model",
      title: "Label task API model",
      prompt: "Compare model labels",
      status: "review",
      execution: {
        kind: "api",
        modelSelection: { providerId: "fixture-provider", modelId: "fixture-model" },
        mode: "build",
      },
      archived: false,
      stopPending: false,
      runSeq: 1,
      createdAt: 100,
      updatedAt: 4000,
    });
    f.notifyWork();
  });
  const card = (title) =>
    page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  for (const [i, agent, label] of [
    [0, "codex", "Codex"],
    [1, "claude", "Claude"],
  ]) {
    for (const target of [card("Remote ACP " + i), card("Label task " + agent)]) {
      await target.locator("[data-board-agent-label]").getByText(label, { exact: true }).waitFor();
      assert.equal(await target.locator(`[data-acp-agent-icon="${agent}"]`).count(), 1);
      assert.doesNotMatch(await target.locator("[data-board-agent-label]").textContent(), /ACP/);
    }
  }
  const modelTask = card("Label task API model").locator("[data-board-agent-label]");
  await modelTask.getByText("fixture-model", { exact: true }).waitFor();
  const layout = page.getByRole("group", { name: "布局方式", exact: true });
  await layout.getByRole("button", { name: "列表", exact: true }).click();
  for (const title of [
    "Remote API session",
    "Remote ACP 0",
    "Remote ACP 1",
    "Label task codex",
    "Label task claude",
    "Label task API model",
  ]) {
    const label = card(title).locator("[data-board-agent-label]");
    assert.equal(await label.isVisible(), true, `${title} keeps its execution identity in List`);
    assert.ok((await label.innerText()).trim().length > 0, `${title} has a visible label in List`);
  }
  assert.equal(
    (await card("Label task API model").locator("[data-board-agent-label]").innerText()).trim(),
    "fixture-model",
  );
  assert.ok(
    (await card("Label task API model")
      .locator("h3")
      .evaluate((node) => node.clientWidth)) >= 90,
    "the model label leaves readable width for the item title",
  );
  await page.screenshot({
    path: join(artifacts, "agent-labels-list.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await card("Label task API model").locator("[data-board-agent-label]").isVisible(),
    true,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({
    path: join(artifacts, "agent-labels-list-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await layout.getByRole("button", { name: "卡片", exact: true }).click();
  const select = page.getByRole("combobox", { name: "智能体筛选", exact: true });
  assert.equal(await select.locator('option[value="codex"]').textContent(), "Codex");
  await select.selectOption("codex");
  await page.waitForFunction(() => document.querySelectorAll("[data-board-card]").length === 2);
  await card("Remote ACP 0").getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByText(/Same project · Codex · 已完成/)
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "管理显示范围", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索任务、对话或项目…", exact: true })
    .fill("Label task codex");
  await page.getByRole("dialog").getByText("Codex · 已完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  for (const [theme, width] of [
    ["theme-zai-light", 1600],
    ["dark theme-zai-dark", 390],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => (document.documentElement.className = theme), theme);
    for (const title of ["Remote ACP 0", "Label task codex"])
      assert.equal(await card(title).locator("[data-board-agent-label]").textContent(), "Codex");
    await card("Label task codex").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `agent-labels-${width}.png`), fullPage: true });
  }
  await select.selectOption("all");
}
