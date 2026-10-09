import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskSaveRefresh(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) window.__tasks.seed({ title: `Seed ${i}`, prompt: `Seed ${i}` });
    window.__tasks.showCounts(true);
  });
  await page.waitForFunction(() => window.__tasks.listenerCount() === 1);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="work-task-card"]').length === 24,
  );
  for (const kind of ["api", "acp"]) {
    for (const [width, theme] of [
      [1280, "theme-zai-light"],
      [320, "theme-zai-light"],
      [1280, "theme-zai-dark dark"],
      [320, "theme-zai-dark dark"],
    ]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate((value) => {
        document.documentElement.className = value;
      }, theme);
      await panel.getByTestId("work-task-new").click();
      if (kind === "acp") {
        await editor.getByTestId("work-task-model").click();
        await page.getByTestId("chat-model-select-item-acp:codex").click();
      } else {
        await editor.getByTestId("work-task-model").click();
        await page.getByRole("menuitem", { name: "Test API", exact: true }).hover();
        await page.getByTestId("chat-model-select-item-custom:api:TestModel").click();
      }
      const prompt = `Save ${kind} at ${width}`;
      await editor.getByTestId("work-task-prompt").fill(prompt);
      await page.evaluate(() => {
        window.__tasks.delayList = true;
      });
      const reads = await page.evaluate(
        () => window.__tasks.calls.filter((c) => c.op === "list").length,
      );
      await editor.getByTestId("work-task-save").click();
      await editor.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() => window.__tasks.pending.length),
        1,
        "save must close while its shared list response is still pending",
      );
      assert.equal(
        await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "list").length),
        reads + 1,
        "board, sidebar and save completion share one refresh",
      );
      const task = await page.evaluate(() => window.__tasks.tasks.at(-1));
      assert.equal(task.prompt, prompt);
      assert.equal(task.status, "todo");
      await page.evaluate(() => window.__tasks.finish());
      await panel.locator(`[data-task-id="${task.id}"]`).waitFor();
      await page.screenshot({
        path: join(artifacts, `save-refresh-${kind}-${width}-${theme.split(" ")[0]}.png`),
      });
    }
  }
  await panel.getByTestId("work-task-new").click();
  await editor.getByTestId("work-task-prompt").fill("Keep failed draft");
  await page.evaluate(() => {
    window.__tasks.failSave = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.equal(await editor.getByTestId("work-task-prompt").innerText(), "Keep failed draft");
  await page.evaluate(() => {
    window.__tasks.failList = true;
  });
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  await panel.getByRole("alert").filter({ hasText: "Synthetic list failed" }).waitFor();
  assert.ok(await panel.getByTestId("work-task-new").isEnabled());
  assert.equal(
    await page.evaluate(
      () =>
        window.__tasks.calls.filter((c) => c.op === "create" && c.prompt === "Keep failed draft")
          .length,
    ),
    2,
  );
  await page.evaluate(() => window.__tasks.notify());
  await panel
    .getByRole("alert")
    .filter({ hasText: "Synthetic list failed" })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () => window.__tasks.tasks.filter((t) => t.prompt === "Keep failed draft").length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) => /^(start|acp-create|acp-prompt)$/.test(c.op)),
    ),
    false,
  );
}
