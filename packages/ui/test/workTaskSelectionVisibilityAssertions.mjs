import assert from "node:assert/strict";
import { join } from "node:path";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

const styles = (card) =>
  card.evaluate((element) => {
    const style = getComputedStyle(element);
    const marker = element.querySelector('[data-testid="work-task-selection-marker"]');
    const bounds = element.getBoundingClientRect();
    const title = element.querySelector('[data-testid="work-task-card-title"]');
    return {
      background: style.backgroundColor,
      border: style.borderLeftColor,
      marker: marker ? getComputedStyle(marker).backgroundColor : null,
      width: bounds.width,
      height: bounds.height,
      titleOffset: title.getBoundingClientRect().x - bounds.x,
    };
  });

export async function exerciseWorkTaskSelectionVisibility(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(() => {
    window.__tasks.seed({
      id: "same-id",
      title: "API 已完成任务：用于核对长标题的选中提示和单行布局",
      prompt: "API",
      status: "done",
    });
    window.__tasks.seed({
      id: "same-id",
      workspacePath: "/synthetic/other",
      title: "ACP 已完成任务：用于核对另一项目相同任务 id 的选中提示",
      prompt: "ACP",
      status: "done",
      execution: { kind: "acp", agent: "codex", config: [] },
    });
  });
  await panel.getByTestId("work-task-project").click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  const api = panel.getByTestId("work-task-card").filter({ hasText: "API 已完成" });
  const acp = panel.getByTestId("work-task-card").filter({ hasText: "ACP 已完成" });
  await acp.waitFor();
  const writes = () =>
    page.evaluate(() => window.__tasks.calls.filter((call) => call.op !== "list"));
  const before = await writes();
  const assertSelection = async (selected, other) => {
    assert.equal(await selected.getAttribute("data-selected"), "true");
    assert.equal(await selected.locator("button[aria-pressed=true]").count(), 1);
    assert.equal(await other.getAttribute("data-selected"), "false");
    assert.equal(await panel.getByTestId("work-task-selection-marker").count(), 1);
    const active = await styles(selected);
    const inactive = await styles(other);
    assert.notEqual(active.background, inactive.background, "selected fill must be distinct");
    assert.notEqual(active.border, inactive.border, "selected border must be distinct");
    assert.equal(active.marker, active.border, "left marker must match the emphasized border");
    await selected.hover();
    assert.deepEqual(await styles(selected), active, "hover must preserve selection");
    await selected.getByRole("button", { name: "任务操作", exact: true }).hover();
    assert.deepEqual(await styles(selected), active, "menu hover must preserve selection");
    await other.hover();
    assert.equal(await other.getByTestId("work-task-selection-marker").count(), 0);
  };

  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280]) {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForFunction(
        () => document.getElementById("work-task-workbench")?.dataset.wide === "true",
      );
      await page.mouse.move(0, 0);
      const initial = await styles(api);
      await api.locator("button[aria-pressed]").click();
      await assertSelection(api, acp);
      const selected = await styles(api);
      for (const key of ["width", "height", "titleOffset"])
        assert.equal(selected[key], initial[key], `selection must not change ${key}`);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-api-selected.png`) });
      await acp.locator("button[aria-pressed]").focus();
      await page.keyboard.press("Enter");
      await assertSelection(acp, api);
      await api.getByRole("button", { name: "任务操作", exact: true }).click();
      assert.equal(await acp.getAttribute("data-selected"), "true");
      await page.keyboard.press("Escape");
      await remountWorkTaskPanel(page, panel);
      await assertSelection(acp, api);
      assert.ok(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
        "long titles must not overflow the panel",
      );
      await page.screenshot({ path: join(artifacts, `${theme}-${width}-acp-selected.png`) });
    }
    // 窄屏选中后只展示会话；返回会清除导航选择，不能为了截图改变既有语义。
    await page.setViewportSize({ width: 320, height: 850 });
    await page.waitForFunction(
      () => document.getElementById("work-task-workbench")?.dataset.wide === "false",
    );
    await panel.getByTestId("work-task-back").click();
    await api.waitFor();
    assert.equal(await panel.getByTestId("work-task-selection-marker").count(), 0);
    await api.locator("button[aria-pressed]").click();
    await panel.getByTestId("work-task-back").waitFor();
    assert.equal(await api.getAttribute("data-selected"), "true");
    assert.equal(await acp.getAttribute("data-selected"), "false");
    await panel.getByTestId("work-task-back").click();
    await api.waitFor();
    assert.equal(await panel.getByTestId("work-task-selection-marker").count(), 0);
    assert.ok(
      await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
      "narrow board must not overflow",
    );
    await page.screenshot({ path: join(artifacts, `${theme}-320-board.png`) });
  }
  assert.deepEqual(await writes(), before, "selection must not issue business commands");
  process.stdout.write(
    "PASS: selection fill, border, marker, hover, keyboard, scoped restore and narrow layout\n",
  );
}
