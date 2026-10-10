import assert from "node:assert/strict";
import { join } from "node:path";

const cases = [
  ["todo", "已加入待办", "foreground-subtle"],
  ["queued", "处理中", "warning"],
  ["preparing", "处理中", "warning"],
  ["running", "处理中", "warning"],
  ["awaiting_input", "等待处理", "interaction-confirmation-foreground"],
  ["review", "待验收", "icon-blue"],
  ["failed", "处理失败", "destructive"],
  ["canceled", "已取消", "foreground-subtle"],
  ["todo", "处理中", "warning", { merge: { phase: "applying" } }],
  [
    "done",
    "已处理，待同步",
    "warning",
    { forgeWriteback: { commentState: "pending", closeState: "done" } },
  ],
  [
    "done",
    "已处理，待同步",
    "warning",
    { forgeWriteback: { commentState: "done", closeState: "failed" } },
  ],
  [
    "done",
    "已处理",
    "success",
    { forgeWriteback: { commentState: "done", closeState: "skipped" } },
  ],
  ["done", "已处理", "success"],
];

async function assertColor(page, target, token) {
  const expected = await page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--color-${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
  // 按钮有颜色过渡；等待最终计算色，不用固定超时掩盖状态刷新问题。
  await page.waitForFunction(({ node, expected }) => getComputedStyle(node).color === expected, {
    node: await target.elementHandle(),
    expected,
  });
  assert.equal(await target.evaluate((node) => getComputedStyle(node).color), expected);
  return expected;
}

export async function assertRepositoryTaskStatusColors(page, panel, artifacts) {
  const handle = panel.getByTestId("repository-item-handle").first();
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      for (const surface of ["list", "detail"]) {
        if (surface === "detail") {
          await panel.getByTestId("repository-item-row").first().click();
          await panel.getByTestId("repository-item-detail").waitFor();
        }
        for (const [status, label, token, fields = {}] of cases) {
          await page.evaluate(
            ({ status, fields }) => {
              const task = window.__forge.tasks[0];
              delete task.merge;
              delete task.forgeWriteback;
              Object.assign(task, fields);
              window.__forge.taskStatus(status);
            },
            { status, fields },
          );
          const text = panel.getByTestId("repository-task-status");
          await page.waitForFunction(
            ({ status, label }) => {
              const text = document.querySelector('[data-testid="repository-task-status"]');
              return text?.dataset.taskStatus === status && text.textContent === label;
            },
            { status, label },
          );
          const expected = await assertColor(page, text, token);
          if (surface === "list") {
            const icon = handle.locator("svg");
            assert.equal(await assertColor(page, icon, token), expected);
            await handle.hover({ force: true });
            await assertColor(page, icon, token);
          }
          if (status === "review") {
            await page.screenshot({
              path: join(artifacts, `${theme}-${width}-${surface}-task-status.png`),
            });
          }
        }
        const bounds = await panel.evaluate((node) => ({
          scroll: node.scrollWidth,
          client: node.clientWidth,
        }));
        assert.ok(bounds.scroll <= bounds.client, `${theme}/${width}/${surface} overflow`);
        if (surface === "detail") {
          await panel.getByRole("button", { name: "关闭详情", exact: true }).click();
          await handle.waitFor();
        }
      }
    }
  }
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    document.documentElement.className = "theme-zai-light";
  });
}
