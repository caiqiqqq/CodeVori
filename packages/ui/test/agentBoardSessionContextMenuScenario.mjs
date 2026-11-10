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
