import assert from "node:assert/strict";
import test from "node:test";
import { acpSessionSchema, type AcpSession } from "@zcode/shared";
import {
  getAcpTerminalTaskNotificationPayload,
  toAcpTaskNotificationState,
  collectTerminalTaskNotificationPayloads,
} from "../src/lib/taskNotificationOrchestrator.ts";

const formatMessage = (({ id }: { id: string }, values?: { title: string }) =>
  values ? `${id}:${values.title}` : id) as Parameters<
  typeof getAcpTerminalTaskNotificationPayload
>[2];
const snapshot = (patch: Partial<AcpSession> = {}) =>
  acpSessionSchema.parse({
    workspacePath: "/tmp/acp-notifications",
    id: "one",
    agent: "codex",
    acpSessionId: "native-one",
    status: "running",
    revision: 1,
    title: "A task",
    entries: [{ kind: "user", id: "user:one", text: "work" }],
    pendingPermission: null,
    error: null,
    ...patch,
  });
const collect = (previous: AcpSession | undefined, next: AcpSession) =>
  getAcpTerminalTaskNotificationPayload(
    previous ? toAcpTaskNotificationState(previous) : undefined,
    toAcpTaskNotificationState(next),
    formatMessage,
  );

test("observed completion reuses localized notification copy and isolates ACP routing", () => {
  assert.deepEqual(collect(snapshot(), snapshot({ status: "idle", revision: 2 })), {
    taskId: "acp:one",
    status: "completed",
    title: "notification.completed",
    body: "notification.taskWithTitle:A task",
  });
});

test("first snapshot, repeated/stale revisions and terminal metadata are silent", () => {
  const idle = snapshot({ status: "idle", revision: 2 });
  assert.equal(collect(undefined, idle), null);
  assert.equal(collect(idle, idle), null);
  assert.equal(collect(snapshot({ revision: 3 }), idle), null);
  assert.equal(collect(idle, snapshot({ status: "idle", revision: 3, title: "renamed" })), null);
  assert.equal(collect(snapshot(), snapshot({ revision: 2 })), null);
});

test("failed turns notify but explicit stops and interrupted unknown outcomes do not", () => {
  assert.equal(
    collect(snapshot(), snapshot({ status: "interrupted", revision: 2, error: "failed" }))?.status,
    "failed",
  );
  assert.equal(
    collect(snapshot(), snapshot({ status: "idle", revision: 2, error: "structured failure" }))
      ?.status,
    "failed",
  );
  assert.equal(collect(snapshot(), snapshot({ status: "interrupted", revision: 2 })), null);
  for (const pauseReason of ["stopped", "error"] as const) {
    assert.equal(
      collect(
        snapshot(),
        snapshot({
          status: "idle",
          revision: 2,
          queue: { items: [], autoDrain: false, pauseReason },
        }),
      ),
      null,
    );
  }
});

test("this turn's end_turn notifies despite a historical stopped or error queue", () => {
  for (const pauseReason of ["stopped", "error"] as const) {
    const queue = { items: [], autoDrain: false, pauseReason };
    const running = snapshot({ queue });
    const completed = snapshot({
      status: "idle",
      revision: 2,
      queue,
      entries: [
        { kind: "user", id: "user:one", text: "work", endedAt: 10, stopReason: "end_turn" },
      ],
    });
    assert.equal(collect(running, completed)?.status, "completed");
    assert.equal(collect(completed, completed), null);
    assert.equal(collect(undefined, completed), null);
    assert.equal(collect(running, { ...completed, error: "structured failure" })?.status, "failed");
  }
});

test("current cancellation and non-success reasons stay silent even with auto-drain enabled", () => {
  for (const stopReason of ["cancelled", "max_tokens", "max_turn_requests", "refusal"] as const) {
    assert.equal(
      collect(
        snapshot(),
        snapshot({
          status: "idle",
          revision: 2,
          entries: [{ kind: "user", id: "user:one", text: "work", endedAt: 10, stopReason }],
        }),
      ),
      null,
    );
  }
});

test("a previous user row's outcome cannot complete the current turn", () => {
  assert.equal(
    collect(
      snapshot(),
      snapshot({
        status: "idle",
        revision: 2,
        queue: { items: [], autoDrain: false, pauseReason: "stopped" },
        entries: [
          { kind: "user", id: "user:old", text: "old", endedAt: 1, stopReason: "end_turn" },
          { kind: "user", id: "user:one", text: "new" },
        ],
      }),
    ),
    null,
  );
});

test("provisional, archived and superseded snapshots cannot notify", () => {
  for (const patch of [
    { provisional: true },
    { archived: true },
    { supersededBy: "11111111-1111-4111-8111-111111111111" },
  ]) {
    assert.equal(collect(snapshot(), snapshot({ ...patch, status: "idle", revision: 2 })), null);
  }
});

test("a later turn can notify again and empty titles reuse the fallback", () => {
  const first = snapshot({ status: "idle", revision: 2 });
  const running = snapshot({ revision: 3 });
  assert.equal(collect(first, running), null);
  assert.equal(
    collect(running, snapshot({ status: "idle", revision: 4, title: " " }))?.body,
    "notification.completedBody",
  );
});

test("observation facts do not retain the streaming transcript or accepted queue", () => {
  const state = toAcpTaskNotificationState(snapshot());
  assert.equal("entries" in state, false);
  assert.equal("queue" in state, false);
});

test("API terminal notifications keep their native identifiers and phase mapping", () => {
  const previous = { sessionId: "api-one", title: "API task", phase: "running" } as never;
  for (const [phase, status] of [
    ["completedSuccess", "completed"],
    ["completedInterrupted", "completed"],
    ["error", "failed"],
  ] as const) {
    const sessions = [{ sessionId: "api-one", title: "API task", phase }] as never;
    const payloads = collectTerminalTaskNotificationPayloads({
      previousBySessionId: new Map([["api-one", previous]]),
      sessions,
      formatMessage,
    });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.taskId, "api-one");
    assert.equal(payloads[0]?.status, status);
  }
});
