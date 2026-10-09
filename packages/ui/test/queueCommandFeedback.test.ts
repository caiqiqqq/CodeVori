import assert from "node:assert/strict";
import test from "node:test";
import { runQueueCommand } from "../src/v4/queueCommandFeedback.js";

test("queue stale recovers its authority, reports failure and never replays", async () => {
  const events: string[] = [];
  const result = await runQueueCommand({
    dispatch: async () => {
      events.push("dispatch");
      return { commandId: "test", status: "stale", revisionAtDecision: 2 };
    },
    isCurrent: () => true,
    recover: () => events.push("recover"),
    onFailure: (kind) => events.push(kind),
  });
  assert.equal(result?.status, "stale");
  assert.deepEqual(events, ["dispatch", "recover", "stale"]);
});

test("late results never recover or report errors in another pane target", async () => {
  for (const failure of [false, true]) {
    const result = await runQueueCommand({
      dispatch: async () => {
        if (failure) throw new Error("synthetic offline");
        return { commandId: "test", status: "stale", revisionAtDecision: 2 };
      },
      isCurrent: () => false,
      recover: () => assert.fail("wrong target recovery"),
      onFailure: () => assert.fail("wrong target feedback"),
    });
    assert.equal(result, null);
  }
});

test("rejection/transport error are visible; accepted/noop/duplicate remain quiet", async () => {
  const events: string[] = [];
  for (const status of ["accepted", "noop", "duplicate", "rejected"] as const) {
    const ack = { commandId: "test", status, revisionAtDecision: 2 };
    assert.equal(
      await runQueueCommand({
        dispatch: async () => ack,
        isCurrent: () => true,
        recover: () => assert.fail("non-stale recovery"),
        onFailure: (kind) => events.push(kind),
      }),
      ack,
    );
  }
  assert.equal(
    await runQueueCommand({
      dispatch: async () => {
        throw new Error("offline");
      },
      isCurrent: () => true,
      recover: () => assert.fail("transport recovery"),
      onFailure: (kind) => events.push(kind),
    }),
    null,
  );
  assert.deepEqual(events, ["rejected", "transport"]);
});
