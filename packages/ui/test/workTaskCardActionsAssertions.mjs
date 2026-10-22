import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskCardActions(page, artifacts) {
  const capture = async (file) => {
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
    await page.screenshot({ path: join(artifacts, file) });
  };
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 850 });
  const panel = page.getByTestId("work-tasks-panel");
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          if (window.__failCopy) throw new Error("Denied");
          window.__copied.push(value);
        },
      },
    });
  });
  const seed = (draft) =>
    page.evaluate((draft) => window.__tasks.seed({ prompt: "Instructions", ...draft }), draft);
  const card = (task) => panel.locator(`[data-testid="work-task-card"][data-task-id="${task.id}"]`);
  const menu = () => page.locator('[role="menu"][data-state="open"]');
  const open = async (task, dropdown = false, label = "任务操作") => {
    if (dropdown) await card(task).getByRole("button", { name: label, exact: true }).click();
    else await card(task).click({ button: "right" });
    await menu().waitFor();
  };
  const pending = await seed({ title: "Unbound" });
  await card(pending).getByRole("button", { name: pending.title, exact: true }).click();
  await open(pending);
  assert.ok(await menu().getByRole("menuitem", { name: "复制会话 ID", exact: true }).isDisabled());
  const contextLabels = await menu().getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await open(pending, true);
  assert.deepEqual(await menu().getByRole("menuitem").allTextContents(), contextLabels);
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  for (const kind of ["api", "acp"]) {
    const task = await seed({
      title: `${kind} running`,
      status: "running",
      session: { kind, id: `${kind}-bound-session` },
      execution:
        kind === "api"
          ? { kind, modelSelection: { providerId: "api", modelId: "TestModel" }, mode: "build" }
          : { kind, agent: "codex" },
    });
    await open(task);
    assert.equal(
      await card(pending).getAttribute("data-selected"),
      "true",
      "right click keeps selection",
    );
    await menu().getByRole("menuitem", { name: "复制会话 ID", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__copied.at(-1)), task.session.id);
    if (kind === "acp") {
      await page.evaluate(() => {
        window.__failCopy = true;
      });
      await open(task);
      await menu().getByRole("menuitem", { name: "复制会话 ID", exact: true }).click();
      await page.getByText("复制会话 ID 失败", { exact: true }).waitFor();
      await page.evaluate(() => {
        window.__failCopy = false;
      });
    }
    await open(task);
    await menu().getByRole("menuitem", { name: "重命名任务", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "重命名任务", exact: true });
    await dialog.getByRole("textbox").fill(`Renamed ${kind}`);
    await dialog.getByRole("textbox").press("Enter");
    await dialog.waitFor({ state: "detached" });
    await card(task)
      .getByRole("button", { name: `Renamed ${kind}`, exact: true })
      .waitFor();
    assert.equal(await card(task).getAttribute("data-selected"), "false");
  }
  for (const status of [
    "todo",
    "queued",
    "preparing",
    "awaiting_input",
    "review",
    "done",
    "failed",
  ]) {
    const task = await seed({ title: `${status} title`, status });
    await open(task, true);
    await menu().getByRole("menuitem", { name: "重命名任务", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "重命名任务", exact: true });
    await dialog.getByRole("textbox").fill(`Renamed ${status}`);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await card(task)
      .getByRole("button", { name: `Renamed ${status}`, exact: true })
      .waitFor();
  }
  await open(pending);
  await menu().getByRole("menuitem", { name: "重命名任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "重命名任务", exact: true });
  const input = dialog.getByRole("textbox");
  await input.fill(" ");
  assert.ok(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled());
  await input.fill("a".repeat(201));
  assert.ok(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled());
  await input.fill("Retry title");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal(
    await page.evaluate(
      () => window.__tasks.calls.filter((c) => c.op === "rename" && c.id === "task-0").length,
    ),
    0,
  );
  await input.dispatchEvent("compositionend");
  await page.evaluate(() => {
    window.__tasks.failSave = true;
  });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await input.inputValue(), "Retry title");
  await page.evaluate(() => {
    window.__tasks.delaySave = true;
  });
  await input.press("Enter");
  await page.waitForFunction(() => window.__tasks.pendingSaves.length === 1);
  await dialog.locator("form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  assert.ok(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled());
  await page.evaluate(() => window.__tasks.finishSave());
  await dialog.waitFor({ state: "detached" });
  await card(pending).getByRole("button", { name: "Retry title", exact: true }).waitFor();
  const writes = await page.evaluate(() =>
    window.__tasks.calls.filter((c) =>
      /^(rename|update|start|cancel|acp-create|acp-prompt)$/.test(c.op),
    ),
  );
  assert.ok(writes.every((c) => c.op === "rename"));
  assert.equal(writes.filter((c) => c.id === pending.id).length, 2);
  await open(pending);
  await menu().getByRole("menuitem", { name: "重命名任务", exact: true }).click();
  await dialog.getByRole("textbox").fill("Canceled title");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "rename").length),
    writes.length,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("button", { name: "返回待办", exact: true }).click();
  await open(pending, true);
  await capture("card-menu-mobile.png");
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.__tasks.setLocale("en-US");
  });
  await open(pending, true, "Task actions");
  await menu().getByRole("menuitem", { name: "Copy session ID", exact: true }).waitFor();
  await menu().getByRole("menuitem", { name: "Rename task", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.getByRole("dialog", { name: "Rename task", exact: true }).waitFor();
  await capture("card-rename-mobile-en.png");
  const englishDialog = page.getByRole("dialog", { name: "Rename task", exact: true });
  await englishDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await englishDialog.waitFor({ state: "detached" });
  await page.evaluate(() => window.__tasks.setLocale("zh-CN"));
  await page.setViewportSize({ width: 1280, height: 850 });
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    await open(pending);
    await capture(`card-context-${theme}.png`);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
  }
}
