import assert from "node:assert/strict";

export async function assertDisconnectedRepositoryMemory({ page, remoteKeys, waitRow }) {
  await page.evaluate((workspaceIdentity) => {
    window.__projects.preferences.getState().selectProject({
      workspacePath: "/synthetic/alpha/project",
      workspaceIdentity,
    });
    window.__projects.select();
  }, remoteKeys[1]);
  await waitRow("remote-one /synthetic/alpha/project private");
  assert.equal(
    await page.evaluate(() => window.__projects.tabs.getState().activeWorkspaceIdentity),
    remoteKeys[0],
  );
}

export async function assertIssueRememberedRemote({ page, panel, detail }) {
  const writes = await page.evaluate(
    () => window.__forge.calls.filter((call) => call.op === "create").length,
  );
  await page.evaluate(() => window.__forge.remount());
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-item-row"]')
      ?.textContent?.includes("B private"),
  );
  await panel.getByRole("button", { name: "新建议题", exact: true }).click();
  const create = page.getByTestId("repository-new-issue");
  await create.getByRole("textbox", { name: "标题", exact: true }).fill("Remembered remote issue");
  assert.equal(
    await page.evaluate(() => window.__forge.calls.filter((call) => call.op === "create").length),
    writes,
  );
  await create.getByRole("button", { name: "创建", exact: true }).click();
  await detail.waitFor();
  const request = await page.evaluate(() =>
    window.__forge.calls.filter((call) => call.op === "create").at(-1),
  );
  assert.equal(request.remoteName, "private");
  assert.equal(request.workspacePath, "/synthetic/B");
  assert.equal(request.host, "B");
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
}

export async function assertRepositorySelectionMemory({ page, panel, waitRow }) {
  await page.evaluate(() => window.__projects.remount());
  await waitRow("local /synthetic/beta/project private");
  await page.evaluate(() => window.__projects.leave());
  await page.getByTestId("conversation-view").waitFor();
  await page.evaluate(() => window.__projects.reenter());
  await waitRow("local /synthetic/beta/project private");
  assert.equal(
    await page.evaluate(() => window.__projects.tabs.getState().activeWorkspacePath),
    "/synthetic/beta/project",
  );
  for (const project of [
    { workspacePath: "/synthetic/closed" },
    { workspacePath: "/synthetic/missing" },
    { workspacePath: "/synthetic/conversation" },
    { workspacePath: "/synthetic/alpha/project", workspaceIdentity: "unknown-remote" },
  ]) {
    await page.evaluate((project) => {
      window.__projects.preferences.getState().selectProject(project);
      window.__projects.select();
    }, project);
    await waitRow("local /synthetic/beta/project private");
    assert.equal(
      await page.evaluate(() => window.__projects.tabs.getState().activeWorkspaceIdentity),
      null,
    );
  }
  assert.equal(
    await panel.getByRole("combobox", { name: "远端仓库", exact: true }).innerText(),
    "private",
  );
}

export async function assertRepositorySelectionReload({ page, panel, waitRow, choose }) {
  await choose("/synthetic/beta/project", "beta");
  await waitRow("local /synthetic/beta/project private");
  await page.reload();
  await waitRow("local /synthetic/alpha/project origin");
  await page.evaluate(() => {
    window.__projects.delayInfo = false;
    window.__projects.pendingInfo.splice(0).forEach((resolve) => resolve());
    window.__projects.select();
  });
  await waitRow("local /synthetic/beta/project private");
  // 删除的 remote 回到 Host 默认；迟到的删除结果不能覆盖新选择。
  await page.evaluate(() => {
    window.__projects.dropPrivate = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await waitRow("local /synthetic/beta/project origin");
  assert.equal(
    await page.evaluate(
      () => window.__projects.preferences.getState().remotes["/synthetic/beta/project"],
    ),
    undefined,
  );
  await page.evaluate(() => {
    window.__projects.dropPrivate = false;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await panel.getByRole("combobox", { name: "远端仓库", exact: true }).click();
  await page.getByRole("option", { name: "private", exact: true }).click();
  await waitRow("local /synthetic/beta/project private");
  await page.evaluate(() => {
    window.__projects.dropPrivate = true;
    window.__projects.delayDiscovery = true;
  });
  await panel.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => window.__projects.pending.length === 1);
  await page.evaluate(() => {
    window.__projects.preferences
      .getState()
      .selectRemote({ workspacePath: "/synthetic/beta/project" }, "origin");
  });
  await waitRow("local /synthetic/beta/project origin");
  await page.evaluate(() => window.__projects.pending.shift()());
  assert.equal(
    await page.evaluate(
      () => window.__projects.preferences.getState().remotes["/synthetic/beta/project"],
    ),
    "origin",
  );
  assert.equal(
    await page.evaluate(() =>
      window.__projects.calls.some((call) => call.op === "write" || call.op === "agent"),
    ),
    false,
  );
}
