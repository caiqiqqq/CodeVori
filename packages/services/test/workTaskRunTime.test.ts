import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkTask } from "@zcode/shared";
import { finishWorkTaskRun, interruptWorkTaskRun } from "../src/session/workTaskRunState.js";

test("run settlement records result time and late settlement preserves existing terminal time", () => {
  const running = { status: "running", updatedAt: 50, runSeq: 1 } as WorkTask;
  const result = finishWorkTaskRun(running, running, { now: 100, leaseExpired: false }).task;
  assert.equal(result.status, "review");
  assert.equal(result.finishedAt, 100);
  const late = finishWorkTaskRun({ ...result, updatedAt: 500 }, running, {
    now: 900,
    leaseExpired: false,
  }).task;
  assert.equal(late.finishedAt, 100);
  assert.equal(interruptWorkTaskRun(running, 200, false).finishedAt, 200);
  assert.equal(interruptWorkTaskRun(result, 900, false).finishedAt, 100);
  const failure = finishWorkTaskRun(running, running, { now: 300, leaseExpired: true }).task;
  assert.equal(failure.status, "failed");
  assert.equal(failure.finishedAt, 300);
});
