// Synthetic forge creation scenarios shared by the repository panel E2E.
import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertIssueDraftAndAttributes({ page, create, countCalls }) {
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("Created issue");
  await create
    .getByRole("textbox", { name: "描述", exact: true })
    .fill("## Created body\n\n**Bold**");
  await create.getByRole("tab", { name: "预览", exact: true }).click();
  await create
    .getByTestId("repository-issue-preview")
    .getByRole("heading", { name: "Created body" })
    .waitFor();
  assert.equal(await countCalls("create"), 0);
  await create.getByRole("tab", { name: "编辑", exact: true }).click();
  await create.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "bug", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "bug", exact: true }).click();
  assert.equal(
    await page
      .getByRole("menuitemcheckbox", { name: "bug", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.getByRole("menuitemcheckbox", { name: "bug", exact: true }).click();
  assert.equal(
    await page
      .getByRole("menuitemcheckbox", { name: "bug", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.keyboard.press("Escape");
  await create
    .getByTestId("repository-selected-labels")
    .getByText("bug", { exact: true })
    .waitFor();
  const labelColor = await create
    .getByTestId("repository-selected-labels")
    .locator('[aria-hidden="true"]')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.equal(labelColor, "rgb(215, 58, 74)");
  await create.getByRole("button", { name: "负责人", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索负责人" }).fill("ali");
  await page.getByRole("menuitemcheckbox", { name: "alice", exact: true }).click();
  await page.keyboard.press("Escape");
  await create.getByRole("combobox", { name: "里程碑", exact: true }).click();
  await page.getByRole("option", { name: "Release", exact: true }).click();
  assert.equal(await create.getByRole("checkbox", { name: "机密议题" }).count(), 0);
  await page.evaluate(() => {
    window.__forge.failWrite = true;
  });
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await create.getByRole("alert").waitFor();
  assert.equal(
    await create.getByRole("textbox", { name: "标题", exact: true }).inputValue(),
    "Created issue",
  );
  assert.equal(
    await create.getByRole("textbox", { name: "描述", exact: true }).inputValue(),
    "## Created body\n\n**Bold**",
  );
  assert.equal(await countCalls("create"), 1);
  await create.getByRole("button", { name: "创建", exact: true }).click();
  const created = await page.evaluate(() =>
    window.__forge.calls.filter((call) => call.op === "create").at(-1),
  );
  assert.deepEqual(created.labels, ["bug"]);
  assert.deepEqual(created.assignees, ["alice"]);
  assert.equal(created.milestone, "3");
}

export async function assertResponsiveIssueCreation({
  page,
  panel,
  create,
  settleVisuals,
  artifacts,
  theme,
  width,
}) {
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("改进议题创建体验");
  await create
    .getByRole("textbox", { name: "描述", exact: true })
    .fill(
      "## 问题描述\n\n描述框需要清晰的边界，标签选择需要明确的入口。\n\n- [ ] 支持标签多选\n- [ ] 保留 Markdown 预览",
    );
  await create.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "bug", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "enhancement", exact: true }).click();
  if (width === 1120) {
    await settleVisuals();
    await page.screenshot({ path: join(artifacts, theme + "-labels-menu.png") });
  }
  await page.keyboard.press("Escape");
  await settleVisuals();
  const editorStyle = await create
    .getByRole("textbox", { name: "描述", exact: true })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: style.borderTopWidth,
        color: style.borderTopColor,
        background: style.backgroundColor,
      };
    });
  assert.equal(editorStyle.border, "1px");
  assert.notEqual(editorStyle.color, "rgba(0, 0, 0, 0)");
  assert.notEqual(editorStyle.background, "rgba(0, 0, 0, 0)");
  const dialogBounds = await create.evaluate((element) => {
    const dialog = element.closest('[role="dialog"]');
    return { width: dialog.scrollWidth, client: dialog.clientWidth };
  });
  assert.ok(dialogBounds.width <= dialogBounds.client, theme + "/" + width + " create overflow");
  await page.screenshot({ path: join(artifacts, theme + "-" + width + "-create.png") });
  await create.getByRole("button", { name: "取消", exact: true }).click();
}

export async function assertIssueCatalogScopeAndGitlab({
  page,
  panel,
  create,
  detail,
  row,
  settleVisuals,
}) {
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.evaluate(() => {
    window.__forge.failOptions = true;
  });
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  await create.getByRole("alert").waitFor();
  assert.equal(
    await create.getByRole("button", { name: "负责人", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await create.getByRole("button", { name: "标签", exact: true }).isEnabled(), true);
  await page.evaluate(() => {
    window.__forge.failOptions = false;
  });
  await create.getByRole("button", { name: "重新加载属性" }).click();
  await create.getByRole("button", { name: "负责人", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="repository-new-issue"] button[aria-label="负责人"]')
        .disabled,
  );
  await create.getByRole("button", { name: "取消", exact: true }).click();
  // 旧 Host 的迟到目录不能覆盖新 Host；关闭/切换也不能触发创建。
  await page.evaluate(() => {
    window.__forge.delayOptions = true;
  });
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("Old Host draft");
  await page.evaluate(() => window.__forge.switchHost("B"));
  await create.waitFor({ state: "detached" });
  await row().waitFor();
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  assert.equal(await create.getByRole("textbox", { name: "标题", exact: true }).inputValue(), "");
  await page.evaluate(() => window.__forge.finish());
  await settleVisuals();
  await create.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => window.__forge.switchHost("A"));
  await row().waitFor();
  await page.evaluate(() => {
    window.__forge.provider = "gitlab";
    window.__forge.remount();
  });
  await row().waitFor();
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("Confidential issue");
  await create.getByLabel("截止日期", { exact: true }).fill("2026-10-31");
  await create.getByRole("checkbox", { name: "机密议题" }).check();
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await detail.waitFor();
  const gitlabCreated = await page.evaluate(() =>
    window.__forge.calls.filter((call) => call.op === "create").at(-1),
  );
  assert.equal(gitlabCreated.dueDate, "2026-10-31");
  assert.equal(gitlabCreated.confidential, true);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
}

export async function assertIssueSettingsDraft({ page, panel, create, settings, countCalls }) {
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("Retained issue title");
  await create.getByRole("textbox", { name: "描述", exact: true }).fill("Retained issue body");
  const writesBeforeSettings = await countCalls("create", "comment");
  await page.evaluate(() => window.__forge.openSettings());
  await settings.waitFor();
  await page.getByRole("button", { name: "返回仓库", exact: true }).click();
  await create.waitFor();
  assert.equal(
    await create.getByRole("textbox", { name: "标题", exact: true }).inputValue(),
    "Retained issue title",
  );
  assert.equal(
    await create.getByRole("textbox", { name: "描述", exact: true }).inputValue(),
    "Retained issue body",
  );
  assert.equal(await countCalls("create", "comment"), writesBeforeSettings);
  await create.getByRole("button", { name: "取消", exact: true }).click();
}
