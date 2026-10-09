import assert from "node:assert/strict";
import { join } from "node:path";

export async function exerciseWorkTaskConcurrentExecution(page, artifacts) {
  for (const theme of ["zai-light", "zai-dark"]) {
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await page.reload();
      const panel = page.getByTestId("work-tasks-panel");
      await panel.getByTestId("work-task-board").waitFor();
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
        window.__tasks.concurrency = 1;
        for (let index = 0; index < 10; index++) {
          const kind = index % 2 === 0 ? "api" : "acp";
          window.__tasks.seed({
            title: `Concurrent ${kind} task ${index}`,
            prompt: "Independent work",
            execution:
              kind === "api"
                ? {
                    kind,
                    modelSelection: { providerId: "api", modelId: "TestModel" },
                    mode: "build",
                  }
                : { kind, agent: "codex", config: [] },
          });
        }
      }, theme);
      await panel.getByTestId("work-task-card").nth(9).waitFor();
      await panel.getByTestId("work-task-start-all").click();
      const progress = panel.locator('[data-work-task-column="inProgress"]');
      await progress.locator('[data-work-task-status="running"]').nth(9).waitFor();
      assert.equal(await progress.getByTestId("work-task-card").count(), 10);
      assert.equal(await progress.locator("h3 > span").last().innerText(), "10");
      assert.equal(await panel.locator('[data-work-task-status="queued"]').count(), 0);
      assert.ok(await panel.getByTestId("work-task-start-all").isDisabled());
      assert.equal(await page.evaluate(() => window.__tasks.concurrency), 1);
      assert.deepEqual(
        await page.evaluate(() => window.__tasks.calls.filter((call) => call.op === "startAll")),
        [{ op: "startAll", workspacePath: "/synthetic/project" }],
        "batch start uses one Host command, without a UI execution queue",
      );
      await page.evaluate(() => {
        window.__tasks.status("task-0", "awaiting_input");
        window.__tasks.status("task-1", "review");
      });
      const attention = panel.locator('[data-work-task-column="attention"]');
      await attention.locator('[data-task-id="task-0"]').waitFor();
      await attention.locator('[data-task-id="task-1"]').waitFor();
      assert.equal(await progress.getByTestId("work-task-card").count(), 8);
      assert.equal(await attention.getByTestId("work-task-card").count(), 2);
      assert.equal(
        await page.evaluate(() =>
          window.__tasks.calls.some((call) =>
            ["concurrency", "create", "start", "update", "acp-create", "acp-prompt"].includes(
              call.op,
            ),
          ),
        ),
        false,
        "task events only refresh the projection; they do not resubmit work",
      );
      await page.screenshot({ path: join(artifacts, `concurrent-tasks-${theme}-${width}.png`) });
    }
  }
}
