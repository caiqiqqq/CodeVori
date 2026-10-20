import assert from "node:assert/strict";
import test from "node:test";
import { acpQueueStateSchema } from "@zcode/shared";
import { queueStateSchema } from "@zcode/shared/zcode-protocol-v4";
import { projectAcpQueue, visibleAcpQueueSubmission } from "../src/v4/acpQueueProjection.js";

test("ACP queue projects stable ids, reserved locks and pause facts into shared queue schema", () => {
  const queue = acpQueueStateSchema.parse({
    autoDrain: false,
    pauseReason: "stopped",
    items: [
      { commandId: "b", text: "second", createdAt: 100, state: "reserved" },
      { commandId: "c", text: "third", createdAt: 101, state: "queued" },
    ],
  });
  const projected = queueStateSchema.parse(projectAcpQueue(queue));
  assert.equal(projected.items[0]?.queueItemId, "b");
  assert.equal(projected.items[0]?.dispatch.state, "reserved");
  assert.equal(projected.items[1]?.order.queuePosition, 1);
  assert.equal(projected.autoDrain, false);
  assert.equal(projected.pauseReason, "stopped");
  assert.equal(projected.items[0]?.steer.state, "notRequested");
});

test("pending submission yields to every Host acceptance receipt without mutating queue facts", () => {
  const pending = { commandId: "pending", text: "follow-up" };
  const queue = acpQueueStateSchema.parse({ items: [], autoDrain: true });
  const session = { queue, entries: [] };
  assert.equal(visibleAcpQueueSubmission(session, pending), pending);
  assert.deepEqual(session, { queue: { items: [], autoDrain: true }, entries: [] });
  assert.equal(visibleAcpQueueSubmission(session, null), null);
  assert.equal(
    visibleAcpQueueSubmission({ ...session, entries: [{ id: "user:pending" }] }, pending),
    null,
  );
  assert.equal(
    visibleAcpQueueSubmission(
      { ...session, queue: { ...queue, items: [{ commandId: "pending" }] } },
      pending,
    ),
    null,
  );
  assert.equal(
    visibleAcpQueueSubmission(
      { ...session, queue: { ...queue, discardedCommandIds: ["pending"] } },
      pending,
    ),
    null,
  );
  assert.equal(
    visibleAcpQueueSubmission({ ...session, entries: [{ id: "user:another" }] }, pending),
    pending,
  );
});
