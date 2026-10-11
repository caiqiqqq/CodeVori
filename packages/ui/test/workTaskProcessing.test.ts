import assert from "node:assert/strict";
import { test } from "node:test";
import { columnForWorkTask } from "../src/lib/workTaskBoard.js";
import type { WorkTask } from "@zcode/shared";
test("merge queue is processing, ordinary queue remains todo and failed merges stay review", () => {
  const task = { status: "queued", merge: { phase: "queued" } } as WorkTask;
  assert.equal(columnForWorkTask(task), "inProgress");
  assert.equal(columnForWorkTask({ ...task, merge: undefined }), "todo");
  assert.equal(
    columnForWorkTask({ ...task, status: "review", merge: { ...task.merge!, phase: "failed" } }),
    "attention",
  );
  assert.equal(
    columnForWorkTask({ ...task, status: "done", merge: { ...task.merge!, phase: "merged" } }),
    "done",
  );
});
