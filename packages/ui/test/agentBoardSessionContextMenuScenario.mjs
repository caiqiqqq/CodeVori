import assert from "node:assert/strict";

export async function exerciseAgentBoardSessionContextMenu(page, screenshotPath) {
  const card = (title = "Remote ACP 0") =>
    page
      .locator("[data-board-card]")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const menu = () => page.locator('[role="menu"][data-state="open"]');
  const rightClick = async (target = card()) => {
    await target.click({ button: "right" });
    await menu().waitFor();
  };

  await rightClick(card("Implement project 5"));
  const offlineMenu = menu();
  assert.equal(
    await offlineMenu.getByRole("menuitem", { name: "打开主会话", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await offlineMenu.getByRole("menuitem", { name: "归档", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");

  await rightClick(card("Waiting for review"));
  const waitingMenu = menu();
  assert.equal(
    await waitingMenu.getByRole("menuitem", { name: "归档", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");

  await rightClick(card("Implement project 3"));
  const runningMenu = menu();
  assert.equal(
    await runningMenu.getByRole("menuitem", { name: "归档", exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press("Escape");

  await rightClick();
  await menu().getByRole("menuitem", { name: "暂存", exact: true }).click();
  await page
    .locator('[data-board-column="staged"]')
    .getByRole("heading", { name: "Remote ACP 0", exact: true })
    .waitFor();

  await rightClick();
  await menu().getByRole("menuitem", { name: "移出暂存", exact: true }).click();
  await page
    .locator('[data-board-column="completed"]')
    .getByRole("heading", { name: "Remote ACP 0", exact: true })
    .waitFor();

  await rightClick();
  await menu().getByRole("menuitem", { name: "归档", exact: true }).click();
  await card().waitFor({ state: "detached" });
  await page.getByRole("tab", { name: /归档/ }).click();
  await card().waitFor();
  await rightClick();
  await menu().getByRole("menuitem", { name: "恢复会话", exact: true }).click();
  await page.getByRole("tab", { name: /^全部/ }).click();
  await card().waitFor();

  await rightClick();
  await menu().getByRole("menuitem", { name: "打开主会话", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="navigation"]')?.textContent === "acp:remote:0",
  );

  await card().getByRole("button").first().click();
  const details = page.getByRole("dialog");
  await details.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  await details
    .getByRole("heading", { name: "Remote ACP 0", exact: true })
    .click({ button: "right" });
  await menu().getByRole("menuitem", { name: "打开主会话", exact: true }).waitFor();
  if (screenshotPath) await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await menu().getByRole("menuitem", { name: "打开主会话", exact: true }).click();
  await details.getByRole("button", { name: "返回看板", exact: true }).click();
  await details.waitFor({ state: "hidden" });
}

export async function exerciseAgentBoardSessionMenuActions(page) {
  const card = (title) =>
    page.locator("[data-board-card]").filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
  const menu = () => page.locator('[role="menu"][data-state="open"]');
  const rightClick = async (title) => {
    await page.locator('[role="menu"]').waitFor({ state: "detached" });
    await card(title).click({ button: "right" });
    await menu().waitFor();
  };
  const copied = async (value) =>
    page.waitForFunction(
      async (expected) => (await navigator.clipboard.readText()) === expected,
      value,
    );
  const commands = () => page.evaluate(() => window.__board.commands);

  await rightClick("Implement project 5");
  assert.equal(await menu().getByRole("menuitem", { name: "重命名任务" }).isDisabled(), true);
  assert.equal(await menu().getByRole("menuitem", { name: "标记为未读" }).isDisabled(), true);
  await menu().getByRole("menuitem", { name: "复制路径" }).click();
  await copied("/fixture/project-5");
  await rightClick("Implement project 5");
  await menu().getByRole("menuitem", { name: "复制会话 ID" }).click();
  await copied("same-id");

  await rightClick("Remote API session");
  await menu().getByRole("menuitem", { name: "重命名任务" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名任务" });
  await renameDialog.getByPlaceholder("任务名称").fill("Renamed API session");
  await page.evaluate(() => (window.__board.rejectRename = true));
  await renameDialog.getByRole("button", { name: "确认" }).click();
  await renameDialog.waitFor();
  await page.waitForFunction(() =>
    window.__board.commands.some((command) => command.kind === "native-rename"),
  );
  assert.equal(
    await page.evaluate(() => window.__board.native[0].title),
    "Remote API session",
    "failed rename must keep the old title",
  );
  await page.evaluate(() => (window.__board.rejectRename = false));
  await renameDialog.getByRole("button", { name: "确认" }).click();
  await card("Renamed API session").waitFor();
  assert.deepEqual(
    (await commands()).filter((command) => command.kind === "native-rename").at(-1),
    {
      kind: "native-rename",
      host: "host-0",
      taskId: "same-id",
      workspacePath: "/same",
      workspaceIdentity: "remote:0",
      title: "Renamed API session",
    },
  );
  await rightClick("Renamed API session");
  await menu().getByRole("menuitem", { name: "标记为未读" }).click();
  await card("Renamed API session").locator("[data-board-unread]").waitFor();
  assert.equal(
    (await commands()).some(
      (command) =>
        command.kind === "native" &&
        command.address.workspaceIdentity === "remote:0" &&
        command.mutation.kind === "mark-unread",
    ),
    true,
  );
  await rightClick("Renamed API session");
  assert.equal(await menu().getByRole("menuitem", { name: "标记为未读" }).isDisabled(), true);
  assert.equal(await menu().getByRole("menuitem", { name: "反馈问题" }).count(), 0);
  await page.keyboard.press("Escape");

  await rightClick("Remote ACP 0");
  await menu().getByRole("menuitem", { name: "重命名任务" }).click();
  await renameDialog.getByPlaceholder("任务名称").fill("Renamed ACP session");
  await renameDialog.getByRole("button", { name: "确认" }).click();
  await card("Renamed ACP session").waitFor();
  assert.equal(
    (await commands()).some(
      (command) =>
        command.kind === "acp" &&
        command.workspaceIdentity === "remote:0" &&
        command.remoteSessionId === "host-0" &&
        command.action.kind === "rename" &&
        command.action.title === "Renamed ACP session",
    ),
    true,
  );
  await rightClick("Renamed ACP session");
  await menu().getByRole("menuitem", { name: "标记为未读" }).click();
  await card("Renamed ACP session").locator("[data-board-unread]").waitFor();
  await rightClick("Renamed ACP session");
  assert.equal(await menu().getByRole("menuitem", { name: "反馈问题" }).count(), 0);
  await page.keyboard.press("Escape");

  await card("Renamed ACP session").getByRole("button").first().click();
  const details = page.getByRole("dialog");
  await details.getByRole("heading", { name: "Renamed ACP session" }).click({ button: "right" });
  assert.equal(await menu().getByRole("menuitem", { name: "标记为未读" }).count(), 0);
  assert.equal(await menu().getByRole("menuitem", { name: "反馈问题" }).count(), 0);
  await page.keyboard.press("Escape");
  await details.getByRole("button", { name: "返回看板" }).click();
}
