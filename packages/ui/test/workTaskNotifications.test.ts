import assert from "node:assert/strict";
import test from "node:test";
import type { WorkTask } from "@zcode/shared";
import {
  getWorkTaskWaitingNotification,
  toWorkTaskNotificationFact,
  workTaskNotificationId,
} from "../src/lib/workTaskNotifications.js";

const scope = { workspacePath: "/project" };
const task = (patch: Partial<WorkTask> = {}) =>
  ({
    id: "one",
    title: "后台待办",
    status: "running",
    runSeq: 1,
    updatedAt: 1,
    archived: false,
    stopPending: false,
    ...scope,
    ...patch,
  }) as WorkTask;
const format = (({ id }, values) => `${id}${values ? `:${values.title}` : ""}`) as Parameters<
  typeof getWorkTaskWaitingNotification
>[3];
const collect = (previous: WorkTask | undefined, next: WorkTask) =>
  getWorkTaskWaitingNotification(
    previous && toWorkTaskNotificationFact(previous),
    next,
    scope,
    format,
  );

test("API and ACP waiting edges use localized copy and task-scoped routing", () => {
  for (const kind of ["api", "acp"] as const) {
    const next = task({ status: "awaiting_input", updatedAt: 2, execution: { kind } as never });
    assert.deepEqual(collect(task(), next), {
      taskId: workTaskNotificationId(scope, "one", 1),
      status: "elicitation_request",
      requestId: JSON.stringify([workTaskNotificationId(scope, "one", 1), 1, 2]),
      title: "notification.taskWaiting",
      body: "notification.taskWithTitle:后台待办",
    });
  }
});

test("initial, repeated, stale, unknown/new runs and non-waiting states are silent", () => {
  const waiting = task({ status: "awaiting_input", updatedAt: 2 });
  assert.equal(collect(undefined, waiting), null);
  assert.equal(collect(waiting, task({ ...waiting, updatedAt: 3, title: "renamed" })), null);
  assert.equal(collect(task({ updatedAt: 3 }), waiting), null);
  assert.equal(collect(task(), task({ ...waiting, runSeq: 2 })), null);
  for (const status of ["todo", "review", "failed", "done", "canceled"] as const) {
    assert.equal(collect(task({ status }), waiting), null);
    assert.equal(collect(task(), task({ status, updatedAt: 2 })), null);
  }
});

test("stop/archive do not notify; preparation, merge queue and repeated waits do", () => {
  const waiting = task({ status: "awaiting_input", updatedAt: 2 });
  for (const patch of [{ archived: true }, { stopPending: true }]) {
    assert.equal(collect(task(), task({ ...waiting, ...patch })), null);
    assert.equal(collect(task(patch), waiting), null);
  }
  for (const status of ["preparing", "running", "queued"] as const)
    assert.ok(collect(task({ status }), waiting));
  const again = collect(task({ updatedAt: 3 }), task({ ...waiting, updatedAt: 4 }));
  assert.ok(again);
  assert.notEqual(again.requestId, collect(task(), waiting)?.requestId);
  assert.equal(collect(task(), task({ ...waiting, title: " " }))?.body, "notification.taskWaiting");
});

test("notification facts are bounded and scope identifiers isolate equal task ids", () => {
  assert.deepEqual(
    Object.keys(toWorkTaskNotificationFact(task())).sort(),
    ["id", "status", "runSeq", "updatedAt", "archived", "stopPending"].sort(),
  );
  const local = workTaskNotificationId(scope, "one", 1);
  assert.equal(local, workTaskNotificationId({ ...scope, workspaceIdentity: "  " }, "one", 1));
  const remote = { ...scope, workspaceIdentity: "remote:a", remoteSessionId: "a" };
  assert.notEqual(local, workTaskNotificationId(remote, "one", 1));
  assert.notEqual(local, workTaskNotificationId(scope, "one", 2));
  assert.notEqual(
    workTaskNotificationId(remote, "one", 1),
    workTaskNotificationId({ ...remote, workspaceIdentity: "remote:b" }, "one", 1),
  );
  assert.notEqual(
    workTaskNotificationId(remote, "one", 1),
    workTaskNotificationId({ ...remote, remoteSessionId: "b" }, "one", 1),
  );
  assert.notEqual(
    workTaskNotificationId(remote, "one", 1),
    workTaskNotificationId({ ...remote, workspacePath: "/other" }, "one", 1),
  );
});
