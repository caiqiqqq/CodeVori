import assert from "node:assert/strict";
import test from "node:test";
import { partitionDelegationTasksByTurn } from "../src/delegation/delegationTurnPlacement.js";

const turns = [
  { turnId: "first", startedAt: 100 },
  { turnId: "second", startedAt: 300 },
];

test("delegations stay with their originating turn when later turns arrive", () => {
  const tasks = [
    { id: "older", createdAt: 150 },
    { id: "same-turn", createdAt: 220 },
    { id: "newer", createdAt: 340 },
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
  assert.deepEqual(result.unmatched, []);
});

test("unloaded, missing and ambiguous turn timestamps never attach to the latest turn", () => {
  const tasks = [
    { id: "unloaded", createdAt: 90 },
    { id: "ambiguous", createdAt: 310 },
    { id: "valid", createdAt: 350 },
  ];
  const result = partitionDelegationTasksByTurn(
    [...turns, { turnId: "same-start", startedAt: 300 }, { turnId: "unknown", startedAt: 0 }],
    tasks,
  );
  assert.deepEqual(result.byTurn.get("second"), undefined);
  assert.deepEqual(result.byTurn.get("same-start"), undefined);
  assert.deepEqual(
    result.unmatched.map((task) => task.id),
    ["unloaded", "ambiguous", "valid"],
  );
});

test("a task remains visible at the session level until its turn is loaded", () => {
  const tasks = [{ id: "historical", createdAt: 150 }];
  assert.deepEqual(partitionDelegationTasksByTurn(turns.slice(1), tasks).unmatched, tasks);
  assert.deepEqual(partitionDelegationTasksByTurn(turns, tasks).byTurn.get("first"), tasks);
});

test("a completed turn does not claim a later delegation before the next turn loads", () => {
  const tasks = [{ id: "later", createdAt: 250 }];
  const first = { turnId: "first", startedAt: 100, header: { endedAt: 200 } };
  assert.deepEqual(partitionDelegationTasksByTurn([first], tasks).unmatched, tasks);
  assert.deepEqual(
    partitionDelegationTasksByTurn([first, { turnId: "second", startedAt: 240 }], tasks).byTurn.get(
      "second",
    ),
    tasks,
  );
});
