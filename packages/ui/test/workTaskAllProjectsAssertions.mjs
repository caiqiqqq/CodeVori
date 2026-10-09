import assert from "node:assert/strict";
import { join } from "node:path";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskAllProjects(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  const card = (title) =>
    panel
      .getByTestId("work-task-card")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) });
  const choose = async (name) => {
    await panel.getByTestId("work-task-project").click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await page.evaluate(() => {
    window.__tasks.seed({ id: "shared-id", title: "Local API", prompt: "Local" });
    window.__tasks.seed({
      id: "shared-id",
      workspacePath: "/synthetic/other",
      title: "Other ACP",
      prompt: "Other",
      execution: { kind: "acp", agent: "codex", config: [] },
    });
    window.__tasks.seed({
      workspacePath: "/synthetic/other",
      title: "Hidden archive",
      prompt: "Hidden",
      archived: true,
    });
    window.__tasks.seed({
      workspacePath: "/synthetic/other",
      title: "Hidden canceled",
      prompt: "Hidden",
      status: "canceled",
    });
  });
  await card("Local API").waitFor();
  assert.equal(await card("Other ACP").count(), 0);
  await choose("全部");
  await card("Other ACP").waitFor();
  assert.equal(await panel.getByTestId("work-task-card").count(), 2);
  assert.equal(await card("Other ACP").getByTestId("work-task-card-project").innerText(), "Other");
  await card("Local API").click();
  assert.equal(await card("Local API").getAttribute("data-selected"), "true");
  await card("Other ACP").click();
  assert.equal(await card("Local API").getAttribute("data-selected"), "false");
  assert.equal(await card("Other ACP").getAttribute("data-selected"), "true");
  assert.equal(
    await page.evaluate(() => window.__tasks.toolTarget.workspacePath),
    "/synthetic/other",
  );
  await remountWorkTaskPanel(page, panel);
  await card("Other ACP").waitFor();
  assert.equal(await panel.getByTestId("work-task-project").innerText(), "全部");
  assert.equal(await card("Other ACP").getAttribute("data-selected"), "true");
  assert.equal(
    await page.evaluate(
      () =>
        window.__tasks.calls.filter((call) =>
          ["create", "start", "startAll", "archive", "update"].includes(call.op),
        ).length,
    ),
    0,
  );

  await card("Local API").click();
  await page.evaluate(() => {
    window.__tasks.delayList = true;
  });
  await remountWorkTaskPanel(page, panel);
  await page.waitForFunction(() => window.__tasks.pending.length === 1);
  await card("Other ACP").waitFor();
  await page.evaluate(() => window.__tasks.finish());
  await card("Local API").waitFor();
  assert.equal(
    await card("Local API").getAttribute("data-selected"),
    "true",
    "partial reads must not clear restored selection",
  );

  for (const theme of ["dark", "light"]) {
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      // 窄屏从会话返回看板，主操作仍可访问。
      const back = panel.getByTestId("work-task-back");
      if (await back.isVisible()) await back.click();
      await panel.getByTestId("work-task-new").click();
      await editor.getByTestId("work-task-editor-project").waitFor();
      await editor.getByTestId("work-task-prompt").fill("Old project draft");
      await editor.getByTestId("work-task-editor-project").click();
      await page.getByRole("option", { name: "Other", exact: true }).click();
      await editor.getByText("/synthetic/other", { exact: true }).waitFor();
      assert.equal((await editor.getByTestId("work-task-prompt").innerText()).trim(), "");
      await editor.getByTestId("work-task-prompt").fill(`Created for Other ${theme} ${width}`);
      await page.waitForFunction(
        () => window.__tasks.gitReads.at(-1)?.workspacePath === "/synthetic/other",
      );
      const bounds = await editor.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
      assert.equal(await editor.evaluate((node) => node.scrollWidth > node.clientWidth), false);
      await page.screenshot({ path: join(artifacts, `all-projects-${theme}-${width}.png`) });
      await editor.getByTestId("work-task-save").click();
      await editor.waitFor({ state: "detached" });
      const created = await page.evaluate(() =>
        window.__tasks.calls.filter((call) => call.op === "create").at(-1),
      );
      assert.equal(created.workspacePath, "/synthetic/other");
      assert.equal(created.sourceBranch, "main");
      assert.equal(await panel.getByTestId("work-task-project").innerText(), "全部");
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await choose("Other");
  assert.equal(await card("Local API").count(), 0);
  await choose("全部");
  await card("Created for Other dark 1280")
    .getByRole("button", { name: "任务操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await card("Created for Other dark 1280").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(
      () => window.__tasks.calls.filter((call) => call.op === "archive").at(-1).workspacePath,
    ),
    "/synthetic/other",
  );
  // 编辑其他项目的同 id 任务，项目不可移动且 update/start 路由正确。
  await card("Other ACP").getByRole("button", { name: "任务操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑任务", exact: true }).click();
  assert.equal(await editor.getByTestId("work-task-editor-project").count(), 0);
  await editor.getByText("/synthetic/other", { exact: true }).waitFor();
  await editor.getByTestId("work-task-prompt").fill("Edited other task");
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  const update = await page.evaluate(() =>
    window.__tasks.calls.filter((call) => call.op === "update").at(-1),
  );
  assert.equal(update.workspacePath, "/synthetic/other");
  assert.equal(update.id, "shared-id");
  assert.equal(
    await page.evaluate(
      () => window.__tasks.tasks.find((task) => task.title === "Local API").prompt,
    ),
    "Local",
  );
  await panel.getByTestId("work-task-start-all").click();
  await page.waitForFunction(
    () => window.__tasks.calls.filter((call) => call.op === "startAll").length === 2,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.__tasks.calls
        .filter((call) => call.op === "startAll")
        .map((call) => call.workspacePath),
    ),
    ["/synthetic/project", "/synthetic/other"],
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__tasks.calls.filter((call) =>
          ["acp-create", "acp-prompt", "acp-setConfigOption"].includes(call.op),
        ).length,
    ),
    0,
  );
  await page.evaluate(() => window.__tasks.setLocale("en-US"));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="work-task-project"]').textContent === "All",
  );
  await panel.getByTestId("work-task-new").click();
  await editor.getByTestId("work-task-editor-project").waitFor();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await page.evaluate(() => window.__tasks.setWorkspace("none"));
  await panel.getByTestId("work-task-new").waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="work-task-new"]').disabled,
  );
  assert.equal(await panel.getByTestId("work-task-card").count(), 0);
  process.stdout.write(
    "All projects: aggregation, scope collision, selection persistence, creation/edit routing, batch start, project removal, themes and 320px passed\n",
  );
}
