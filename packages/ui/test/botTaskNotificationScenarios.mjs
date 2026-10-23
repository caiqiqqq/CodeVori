import assert from "node:assert/strict";

export async function verifyPausedAcpTurnNotifications(page, previousCount) {
  // A prior queue pause must not suppress the next ordinary ACP turn's Bot notification.
  await page.evaluate(() => {
    const s = window.__fixture;
    const index = s.acp.findLastIndex((x) => x.live && x.scope.workspacePath === "/linked");
    const turn = {
      id: "ordinary-acp",
      queue: { items: [], autoDrain: false, pauseReason: "stopped" },
      entries: [{ kind: "user", id: "user:continued", text: "private", createdAt: 21 }],
    };
    s.emitAcp({ ...turn, status: "running", revision: 21 }, index);
    s.emitAcp(
      {
        ...turn,
        status: "idle",
        revision: 22,
        entries: [{ ...turn.entries[0], endedAt: 22, stopReason: "end_turn" }],
      },
      index,
    );
  });
  const expectedCount = previousCount + 1;
  await page.waitForFunction((count) => window.__fixture.sent.length === count, expectedCount);
  assert.equal(await page.evaluate(() => window.__fixture.sent.at(-1).source), "acp");
  assert.equal(await page.evaluate(() => window.__fixture.sent.at(-1).status), "completed");
  await page.evaluate(() => {
    const s = window.__fixture;
    const index = s.acp.findLastIndex((x) => x.live && x.scope.workspacePath === "/linked");
    s.emitAcp({ id: "ordinary-acp", status: "idle", revision: 22 }, index);
    const entries = [{ kind: "user", id: "user:cancelled", text: "private", createdAt: 23 }];
    s.emitAcp({ id: "ordinary-acp", status: "running", revision: 23, entries }, index);
    s.emitAcp(
      {
        id: "ordinary-acp",
        status: "idle",
        revision: 24,
        entries: [{ ...entries[0], endedAt: 24, stopReason: "cancelled" }],
      },
      index,
    );
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.__fixture.sent.length), expectedCount);
}
