import assert from "node:assert/strict";
import test from "node:test";
import { compareBoardItems, type BoardItem } from "../src/agent-board/agentBoardModel.js";

const item = (key: string, startedAt: number, updatedAt: number) =>
  ({ key, kind: "native", status: "running", startedAt, updatedAt }) as BoardItem;

test("concurrent progress and waiting do not reorder a run; a new run does", () => {
  const a = item("a", 100, 900),
    b = item("b", 200, 800);
  assert.deepEqual(
    [a, b].sort(compareBoardItems).map((row) => row.key),
    ["b", "a"],
  );
  for (const status of ["running", "waiting"] as const) {
    assert.ok(compareBoardItems({ ...a, status, updatedAt: 10000 }, b) > 0);
  }
  assert.ok(compareBoardItems(item("a", 300, 11000), b) < 0);
  assert.ok(compareBoardItems(item("a", 200, 11000), b) < 0, "ties use stable entity keys");
});

test("terminal sorting continues to use result time independently of run and metadata time", () => {
  const a = { ...item("a", 100, 9000), status: "completed", completedAt: 500 } as BoardItem;
  const b = { ...item("b", 200, 8000), status: "error", completedAt: 600 } as BoardItem;
  assert.ok(compareBoardItems(a, b) > 0);
  assert.ok(compareBoardItems({ ...a, updatedAt: 20000 }, b) > 0);
});
