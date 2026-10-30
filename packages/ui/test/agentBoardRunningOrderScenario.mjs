import assert from "node:assert/strict";

export async function exerciseAgentBoardRunningOrder(page) {
  const keys = [
    ["remote:0", "native", "same-id"],
    ["remote:0", "acp", "same-id"],
    ["remote:1", "acp", "same-id"],
    ["/fixture/project-3", "work-task", "staging-review"],
  ].map((parts) => JSON.stringify(parts));
  const order = (column = "running") =>
    page
      .locator(`[data-board-column="${column}"] [data-board-card]`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-board-card")));
  const waitOrder = async (expected, column = "running") => {
    await page.waitForFunction(
      ({ expected, column }) =>
        JSON.stringify(
          [...document.querySelectorAll(`[data-board-column="${column}"] [data-board-card]`)].map(
            (node) => node.getAttribute("data-board-card"),
          ),
        ) === JSON.stringify(expected),
      { expected, column },
    );
    assert.deepEqual(await order(column), expected);
  };
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((keys) => {
      const f = window.__board;
      f.update(0, {
        title: "Stable native",
        liveStatus: "running",
        pendingInteraction: undefined,
        sourceAvailability: "online",
        updatedAt: 90000,
        activity: {
          phase: "running",
          turnStartedAt: 10000,
          lastActivityAt: 90000,
          hasBackgroundWork: false,
        },
      });
      f.updateAcp(0, {
        title: "Stable ACP 0",
        status: "running",
        pendingPermission: null,
        pendingElicitation: null,
        unreadAt: null,
        entries: [{ kind: "user", text: "Run 0", createdAt: 20000 }],
        history: { createdAt: 100, updatedAt: 80000 },
      });
      f.updateAcp(1, {
        title: "Stable ACP 1",
        status: "running",
        pendingPermission: null,
        pendingElicitation: null,
        entries: [{ kind: "user", text: "Run 1", createdAt: 30000 }],
        history: { createdAt: 100, updatedAt: 70000 },
      });
      const work = f.workRows.find((row) => row.id === "staging-review");
      Object.assign(work, {
        title: "Stable work",
        status: "running",
        startedAt: 40000,
        updatedAt: 60000,
      });
      f.notifyWork();
      const s = f.store.getState();
      s.selectProject(null);
      s.setView("all");
      s.setGroup("status");
      s.setSearch("");
      s.setAgent("all");
      s.setTracking({
        mode: "custom",
        projects: [],
        standalone: false,
        workTasks: false,
        includedItems: keys,
        excludedItems: [],
      });
    }, keys);
    const expected = [...keys].reverse();
    await waitOrder(expected);
    // 交替推进所有来源的更新时间；标题标记用于确认真实组件已消费该轮更新。
    for (let step = 0; step < 3; step++) {
      await page.evaluate((step) => {
        const f = window.__board,
          updatedAt = 100000 + step * 10000;
        f.update(0, {
          title: `Native progress ${step}`,
          updatedAt,
          activity: {
            phase: "running",
            turnStartedAt: 10000,
            lastActivityAt: updatedAt,
            hasBackgroundWork: step === 2,
          },
        });
        f.updateAcp(0, {
          title: `ACP progress ${step}`,
          history: { createdAt: 100, updatedAt: updatedAt + 1000 },
        });
        const work = f.workRows.find((row) => row.id === "staging-review");
        Object.assign(work, { title: `Work progress ${step}`, updatedAt: updatedAt + 2000 });
        f.notifyWork();
      }, step);
      await page.getByRole("heading", { name: `Native progress ${step}`, exact: true }).waitFor();
      await page.getByRole("heading", { name: `ACP progress ${step}`, exact: true }).waitFor();
      await page.getByRole("heading", { name: `Work progress ${step}`, exact: true }).waitFor();
      assert.deepEqual(await order(), expected);
    }
    await page.evaluate(() => {
      const f = window.__board;
      f.updateAcp(0, {
        title: "ACP waiting",
        pendingPermission: { requestId: "p", title: "Wait", options: [] },
      });
      f.update(0, {
        title: "Native background",
        liveStatus: "completed",
        activity: {
          phase: "completedSuccess",
          turnStartedAt: 10000,
          lastActivityAt: 200000,
          hasBackgroundWork: true,
        },
      });
    });
    await page.getByRole("heading", { name: "ACP waiting", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Native background", exact: true }).waitFor();
    assert.deepEqual(await order(), expected);
    // 新轮开始后重排，即使没有观察到中间的 completed 帧。
    await page.evaluate(() =>
      window.__board.updateAcp(0, {
        title: "ACP next turn",
        pendingPermission: null,
        entries: [{ kind: "user", text: "Next", createdAt: 300000 }],
        history: { createdAt: 100, updatedAt: 300000 },
      }),
    );
    await waitOrder([keys[1], keys[3], keys[2], keys[0]]);
    await page.evaluate(() =>
      window.__board.update(0, {
        title: "Native next turn",
        liveStatus: "running",
        updatedAt: 400000,
        activity: {
          phase: "running",
          turnStartedAt: 400000,
          lastActivityAt: 400000,
          hasBackgroundWork: false,
        },
      }),
    );
    await waitOrder([keys[0], keys[1], keys[3], keys[2]]);
    await page.evaluate(() => {
      const f = window.__board,
        work = f.workRows.find((row) => row.id === "staging-review");
      Object.assign(work, { title: "Work next run", runSeq: work.runSeq + 1, startedAt: 500000 });
      f.notifyWork();
    });
    await waitOrder([keys[3], keys[0], keys[1], keys[2]]);
    await page.evaluate(() => {
      const f = window.__board;
      f.update(0, {
        liveStatus: "completed",
        activity: {
          phase: "completedSuccess",
          turnStartedAt: 400000,
          lastActivityAt: 600000,
          hasBackgroundWork: false,
        },
      });
      f.updateAcp(0, {
        status: "idle",
        entries: [{ kind: "user", text: "Done", createdAt: 300000, endedAt: 700000 }],
        history: { createdAt: 100, updatedAt: 300000 },
      });
    });
    await waitOrder([keys[1], keys[0]], "completed");
    // 历史无开始时间使用创建时间，不使用最新活动时间；不同远端同 id 仍独立。
    await page.evaluate(() => {
      const f = window.__board;
      f.updateAcp(0, {
        status: "running",
        title: "Legacy run",
        entries: [{ kind: "user", text: "Old" }],
        history: { createdAt: 100, updatedAt: 900000 },
      });
      f.updateAcp(1, {
        title: "Dated run",
        entries: [{ kind: "user", text: "Dated", createdAt: 1000 }],
        history: { createdAt: 100, updatedAt: 1000 },
      });
    });
    await waitOrder([keys[3], keys[2], keys[1]]);
  }
}
