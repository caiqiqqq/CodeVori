import assert from "node:assert/strict";
import test from "node:test";
import { partitionDelegationTasksByTurn } from "../src/delegation/delegationTurnPlacement.js";

const turns = [
  { turnId: "first", startedAt: 100 },
  { turnId: "second", startedAt: 300 },
];

test("delegations stay with their originating turn when later turns arrive", () => {
  const tasks = [
    { id: "older", createdAt: 150, status: "running" },
    { id: "same-turn", createdAt: 220, status: "running" },
    { id: "newer", createdAt: 340, status: "running" },
  ];
  const result = partitionDelegationTasksByTurn(turns, tasks);
  assert.deepEqual(
    result.byTurn.get("first")?.map((task) => task.id),
    ["older", "same-turn"],
  );
  assert.deepEqual(
    result.byTurn.get("second")?.map((task) => task.id),
    ["newer"],
  );
  assert.deepEqual(result.footerTasks, []);
});

test("unloaded, missing and ambiguous turn timestamps never attach to the latest turn", () => {
  const tasks = [
    { id: "unloaded", createdAt: 90, status: "running" },
    { id: "ambiguous", createdAt: 310, status: "running" },
    { id: "valid", createdAt: 350, status: "running" },
  ];
  const result = partitionDelegationTasksByTurn(
    [...turns, { turnId: "same-start", startedAt: 300 }, { turnId: "unknown", startedAt: 0 }],
    tasks,
  );
  assert.deepEqual(result.byTurn.get("second"), undefined);
  assert.deepEqual(result.byTurn.get("same-start"), undefined);
  assert.deepEqual(
    result.footerTasks.map((task) => task.id),
    ["unloaded", "ambiguous", "valid"],
  );
});

test("a task remains visible at the session level until its turn is loaded", () => {
  const tasks = [{ id: "historical", createdAt: 150, status: "running" }];
  assert.deepEqual(partitionDelegationTasksByTurn(turns.slice(1), tasks).footerTasks, tasks);
  assert.deepEqual(partitionDelegationTasksByTurn(turns, tasks).byTurn.get("first"), tasks);
});

test("a completed turn does not claim a later delegation before the next turn loads", () => {
  const tasks = [{ id: "later", createdAt: 250, status: "running" }];
  const first = { turnId: "first", startedAt: 100, header: { endedAt: 200 } };
  assert.deepEqual(partitionDelegationTasksByTurn([first], tasks).footerTasks, tasks);
  assert.deepEqual(
    partitionDelegationTasksByTurn([first, { turnId: "second", startedAt: 240 }], tasks).byTurn.get(
      "second",
    ),
    tasks,
  );
});

test("successful delegations disappear while recoverable terminal tasks stay in the footer", () => {
  const tasks = ["failed", "interrupted", "canceled"].map((status, index) => ({
    id: status,
    createdAt: 151 + index,
    status,
  }));
  const completed = { id: "completed", createdAt: 150, status: "completed" };
  const allTasks = [completed, ...tasks];
  const beforeHistory = partitionDelegationTasksByTurn(turns.slice(1), allTasks);
  const afterHistory = partitionDelegationTasksByTurn(turns, allTasks);
  assert.deepEqual(beforeHistory.footerTasks, tasks);
  assert.deepEqual(afterHistory.footerTasks, tasks);
  assert.equal(afterHistory.byTurn.has("first"), false);
  assert.equal(afterHistory.byTurn.size, 0);
});

test("a completed delegation disappears from its originating turn", () => {
  const running = [{ id: "child", createdAt: 150, status: "running" }];
  const completed = [{ ...running[0]!, status: "completed" }];
  assert.deepEqual(partitionDelegationTasksByTurn(turns, running).byTurn.get("first"), running);
  const afterCompletion = partitionDelegationTasksByTurn(turns, completed);
  assert.equal(afterCompletion.byTurn.size, 0);
  assert.deepEqual(afterCompletion.footerTasks, []);
  assert.equal(completed[0]?.status, "completed", "hiding a row does not mutate task history");
});
