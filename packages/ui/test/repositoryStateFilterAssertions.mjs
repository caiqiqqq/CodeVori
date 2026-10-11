import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertRepositoryStateFilter(page, panel, artifacts) {
  await page.evaluate(() => {
    const state = window.__forge;
    state.filterItems = [
      { number: 101, kind: "issue", state: "open", title: "开启 · 已处理", taskStatus: "done" },
      { number: 102, kind: "issue", state: "open", title: "开启 · 待验收", taskStatus: "review" },
      {
        number: 103,
        kind: "issue",
        state: "closed",
        title: "关闭 · 已加入待办",
        taskStatus: "todo",
      },
      {
        number: 104,
        kind: "issue",
        state: "closed",
        title: "关闭 · 处理中",
        taskStatus: "running",
      },
      { number: 105, kind: "issue", state: "open", title: "开启 · 未处理" },
      { number: 106, kind: "issue", state: "closed", title: "关闭 · 未处理" },
      {
        number: 107,
        kind: "issue",
        state: "closed",
        title: "关闭 · 处理失败",
        taskStatus: "failed",
      },
      {
        number: 201,
        kind: "pull-request",
        state: "open",
        title: "开启请求 · 已处理",
        taskStatus: "done",
      },
      {
        number: 202,
        kind: "pull-request",
        state: "closed",
        title: "关闭请求 · 处理中",
        taskStatus: "running",
      },
      {
        number: 203,
        kind: "pull-request",
        state: "merged",
        title: "合并请求 · 待验收",
        taskStatus: "review",
      },
    ];
    state.tasks = state.filterItems
      .filter((item) => item.taskStatus)
      .map((item) => ({
        id: crypto.randomUUID(),
        workspacePath: "/synthetic/A",
        title: item.title,
        prompt: "Synthetic independent states",
        execution: state.execution,
        status: item.taskStatus,
        runSeq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: {
          repositoryKey: "Aorigin",
          remoteName: "origin",
          accountId: "A",
          kind: item.kind,
          number: item.number,
          title: item.title,
          url: `https://forge.example.invalid/team/project/issues/${item.number}`,
        },
      }));
    state.taskStatus("done");
    state.remount();
  });
  const rows = panel.getByTestId("repository-item-row");
  const assertRows = async (numbers) => {
    await page.waitForFunction((numbers) => {
      const rows = [...document.querySelectorAll('[data-testid="repository-item-row"]')];
      return (
        JSON.stringify(rows.map((row) => Number(row.textContent.match(/#(\d+)/)?.[1]))) ===
        JSON.stringify(numbers)
      );
    }, numbers);
    assert.deepEqual(
      (await rows.allTextContents()).map((text) => Number(text.match(/#(\d+)/)?.[1])),
      numbers,
    );
  };
  const choose = async (control, option) => {
    await panel.getByRole("combobox", { name: control, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const beforeWrites = await page.evaluate(
    () =>
      window.__forge.calls.filter((call) =>
        ["task-create", "start", "state", "comment", "merge"].includes(call.op),
      ).length,
  );
  for (const theme of ["theme-zai-light", "theme-zai-dark dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className = theme;
    }, theme);
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await choose("议题状态", "开启中");
      await assertRows([101, 102, 105]);
      assert.deepEqual(await panel.getByTestId("repository-task-status").allTextContents(), [
        "已处理",
        "待验收",
      ]);
      assert.equal(await panel.getByTestId("repository-item-handle").nth(2).innerText(), "处理");
      await choose("议题状态", "已关闭");
      await assertRows([103, 104, 106, 107]);
      assert.equal(
        await panel
          .getByTestId("repository-task-status")
          .allTextContents()
          .then((texts) => texts.join("|")),
        "已加入待办|处理中|处理失败",
      );
      await choose("议题状态", "全部");
      await assertRows([101, 102, 103, 104, 105, 106, 107]);
      assert.match(
        await panel.getByRole("combobox", { name: "议题状态", exact: true }).innerText(),
        /议题状态/,
      );
      assert.ok(
        await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
        `${theme}/${width} overflow`,
      );
      await page.screenshot({
        path: join(
          artifacts,
          `state-filter-${theme.includes("dark") ? "dark" : "light"}-${width}.png`,
        ),
      });
    }
  }
  await choose("议题状态", "开启中");
  await assertRows([101, 102, 105]);
  const beforeLists = await page.evaluate(
    () => window.__forge.calls.filter((call) => call.op === "list").length,
  );
  await page.evaluate(() => window.__forge.taskStatus("running"));
  await panel
    .getByTestId("repository-task-status")
    .first()
    .getByText("处理中", { exact: true })
    .waitFor();
  await assertRows([101, 102, 105]);
  assert.equal(
    await page.evaluate(() => window.__forge.calls.filter((call) => call.op === "list").length),
    beforeLists,
  );
  await panel.getByRole("tab", { name: "拉取请求", exact: true }).click();
  await assertRows([201]);
  await choose("请求状态", "已关闭");
  await assertRows([202, 203]);
  await choose("请求状态", "全部");
  await assertRows([201, 202, 203]);
  await page.evaluate(() => window.__forge.setLocale("en-US"));
  await panel.getByRole("combobox", { name: "Request state", exact: true }).waitFor();
  await choose("Request state", "Closed");
  await assertRows([202, 203]);
  await panel.getByRole("tab", { name: "Issues", exact: true }).click();
  for (const width of [1120, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await choose("Issue state", "Open");
    await assertRows([101, 102, 105]);
    await choose("Issue state", "Closed");
    await assertRows([103, 104, 106, 107]);
    await choose("Issue state", "All");
    await assertRows([101, 102, 103, 104, 105, 106, 107]);
    assert.ok(
      await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
      `English/${width} overflow`,
    );
  }
  const afterWrites = await page.evaluate(
    () =>
      window.__forge.calls.filter((call) =>
        ["task-create", "start", "state", "comment", "merge"].includes(call.op),
      ).length,
  );
  assert.equal(afterWrites, beforeWrites, "state filters must never write tasks or forge state");
  await page.evaluate(() => {
    window.__forge.setLocale("zh-CN");
    window.__forge.filterItems = undefined;
    window.__forge.resetTasks();
    window.__forge.remount();
    document.documentElement.className = "theme-zai-light";
  });
  await page.setViewportSize({ width: 1120, height: 850 });
  await assertRows([7]);
}
