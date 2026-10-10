import assert from "node:assert/strict";
import { join } from "node:path";
import { remountWorkTaskPanel } from "./workTaskWorkbenchLayoutAssertions.mjs";

export async function exerciseWorkTaskSource(page, artifacts) {
  const panel = page.getByTestId("work-tasks-panel");
  const content = panel.getByTestId("work-task-content");
  const header = content.getByTestId("work-task-source-header");
  const link = (container) => container.getByTestId("work-task-source-link");
  const card = (task) => panel.locator(`[data-task-id="${task.id}"]`);
  await panel.getByTestId("work-task-board").waitFor();
  const tasks = await page.evaluate(() => {
    const source = {
      repositoryKey: "github:forge.invalid/team/project",
      remoteName: "origin",
      accountId: "00000000-0000-4000-8000-000000000001",
      kind: "issue",
      number: 52,
      url: "https://forge.invalid/team/project/issues/52",
      title: "议题原始标题：修复无法选择智能体、模式和模型的问题，并保留任务与原议题的关联记录",
    };
    const issue = window.__tasks.seed({ title: "当前任务标题", prompt: "处理议题", source });
    const pr = window.__tasks.seed({
      title: "另一个任务",
      workspacePath: "/synthetic/other",
      prompt: "审阅 PR",
      status: "review",
      source: {
        ...source,
        repositoryKey: "gitlab:forge.invalid/other/project",
        kind: "pull-request",
        url: "https://forge.invalid/other/project/-/merge_requests/52",
        title: "PR 的原始标题",
      },
      execution: { kind: "acp", agent: "codex", config: [] },
      session: { kind: "acp", id: "source-acp" },
      worktree: {
        path: "/synthetic/trees/source",
        projectPath: "/synthetic/other",
        branchName: "task/source",
        baseCommit: "base",
      },
      merge: {
        id: "merge-source",
        phase: "failed",
        targetBranch: "main",
        session: { kind: "acp", id: "merge-acp" },
        worktree: {
          path: "/synthetic/trees/merge-source",
          projectPath: "/synthetic/other",
          branchName: "merge/source",
          baseCommit: "base",
        },
      },
    });
    const plain = window.__tasks.seed({ title: "议题 #52", prompt: "不要根据标题推断关联" });
    const invalid = window.__tasks.seed({
      title: "无效来源链接",
      prompt: "保存的来源仍然显示",
      source: { ...source, number: 53, url: "file:///synthetic/source" },
    });
    return { issue, pr, plain, invalid };
  });
  await panel.getByTestId("work-task-project").click();
  await page.getByRole("option", { name: "全部", exact: true }).click();
  await card(tasks.pr).waitFor();
  assert.match(await link(card(tasks.issue)).innerText(), /议题 #52/);
  assert.match(await link(card(tasks.pr)).innerText(), /PR #52/);
  assert.equal(await link(card(tasks.plain)).count(), 0);
  assert.equal(await link(card(tasks.invalid)).isDisabled(), true);
  await card(tasks.plain).getByRole("button", { name: tasks.plain.title, exact: true }).click();
  await link(card(tasks.issue)).click();
  assert.equal(await card(tasks.plain).getAttribute("data-selected"), "true");
  assert.equal(await header.count(), 0);
  assert.equal(
    (await page.evaluate(() => window.__tasks.toolCalls)).at(-1).url,
    tasks.issue.source.url,
  );
  await card(tasks.issue).getByRole("button", { name: tasks.issue.title, exact: true }).click();
  assert.match(await link(header).innerText(), /议题原始标题/);
  await link(header).focus();
  await link(header).press("Enter");
  assert.equal(
    (await page.evaluate(() => window.__tasks.toolCalls)).at(-1).url,
    tasks.issue.source.url,
  );
  await content.getByRole("button", { name: "任务详情", exact: true }).click();
  const detail = page.getByTestId("work-task-detail");
  assert.match(await link(detail.getByTestId("work-task-source")).innerText(), /议题 #52/);
  await link(detail).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await remountWorkTaskPanel(page, panel);
  assert.match(await link(header).innerText(), /议题原始标题/);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: join(artifacts, "source-issue-desktop.png"),
    animations: "disabled",
  });
  await card(tasks.pr).getByRole("button", { name: tasks.pr.title, exact: true }).click();
  assert.match(await link(header).innerText(), /PR #52.*PR 的原始标题/s);
  const draft = content.getByRole("textbox", { name: "Synthetic conversation draft" });
  await draft.fill("保留当前对话草稿");
  const node = await draft.elementHandle();
  await link(header).click();
  assert.equal(await node.evaluate((element) => element.isConnected), true);
  assert.equal(await draft.inputValue(), "保留当前对话草稿");
  await content.getByTestId("work-task-toggle-merge-conversation").click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="work-task-fixture-session"]')?.dataset.session ===
      "merge-acp",
  );
  assert.match(await link(header).innerText(), /PR #52.*PR 的原始标题/s);
  await link(header).click();
  assert.equal(
    (await page.evaluate(() => window.__tasks.toolCalls)).at(-1).url,
    tasks.pr.source.url,
  );
  await node.dispose();
  for (const locale of ["zh-CN", "en-US"]) {
    await page.evaluate((locale) => window.__tasks.setLocale(locale), locale);
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        assert.equal(
          await header.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
        );
        assert.equal(
          await panel.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
        );
        await page.screenshot({
          path: join(artifacts, `source-${locale}-${theme}-${width}.png`),
          animations: "disabled",
        });
        if (width === 320) {
          await content.getByTestId("work-task-back").click();
          for (const task of Object.values(tasks)) {
            const bounds = await card(task).boundingBox();
            assert.ok(bounds.height >= 35 && bounds.height <= 37);
            assert.equal(
              await card(task).evaluate((element) => element.scrollWidth > element.clientWidth + 1),
              false,
            );
          }
          await page.screenshot({
            path: join(artifacts, `source-board-${locale}-${theme}-${width}.png`),
            animations: "disabled",
          });
          await card(tasks.pr).getByRole("button", { name: tasks.pr.title, exact: true }).click();
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await card(tasks.plain).getByRole("button", { name: tasks.plain.title, exact: true }).click();
  assert.equal(await header.count(), 0);
  assert.equal(
    (
      await page.evaluate(() =>
        window.__tasks.calls.filter((c) =>
          /^(create|start|merge|complete|update|forge-)/.test(c.op),
        ),
      )
    ).length,
    0,
  );
  process.stdout.write(
    "PASS: task source badges/header/details, exact issue and PR links, keyboard and independent clicks, retained conversation, merge session, restore, invalid URLs, plain tasks and responsive bilingual themes; zero business writes.\n",
  );
}
