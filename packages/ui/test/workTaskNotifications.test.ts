import assert from "node:assert/strict";
import test from "node:test";
import type { WorkTask } from "@zcode/shared";
import {
  getWorkTaskAttentionNotification,
  isWorkTaskNotificationSession,
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
  typeof getWorkTaskAttentionNotification
>[3];
const collect = (previous: WorkTask | undefined, next: WorkTask) =>
  getWorkTaskAttentionNotification(
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

test("review and failure notify from observed execution, including an unresolved wait", () => {
  for (const kind of ["api", "acp"] as const) {
    for (const previousStatus of ["preparing", "running", "queued", "awaiting_input"] as const) {
      for (const status of ["review", "failed"] as const) {
        const next = task({ status, updatedAt: 2, execution: { kind } as never });
        const payload = collect(task({ status: previousStatus }), next);
        assert.equal(payload?.status, status === "review" ? "completed" : "failed");
        assert.equal(
          payload?.title,
          status === "review" ? "notification.taskReview" : "notification.error",
        );
        assert.equal(payload?.taskId, workTaskNotificationId(scope, "one", 1));
        assert.equal(payload?.body, "notification.taskWithTitle:后台待办");
        assert.equal(collect(undefined, next), null);
        assert.equal(collect(next, task({ ...next, updatedAt: 3 })), null);
        assert.equal(collect(task({ updatedAt: 3 }), next), null);
        assert.equal(collect(task(), task({ ...next, runSeq: 2 })), null);
        assert.equal(collect(task({ stopPending: true }), next), null);
        assert.equal(collect(task(), task({ ...next, archived: true })), null);
      }
    }
  }
});

test("initial, repeated, stale, unknown/new runs and inactive states are silent", () => {
  const waiting = task({ status: "awaiting_input", updatedAt: 2 });
  assert.equal(collect(undefined, waiting), null);
  assert.equal(collect(waiting, task({ ...waiting, updatedAt: 3, title: "renamed" })), null);
  assert.equal(collect(task({ updatedAt: 3 }), waiting), null);
  assert.equal(collect(task(), task({ ...waiting, runSeq: 2 })), null);
  for (const status of ["todo", "review", "failed", "done", "canceled"] as const) {
    assert.equal(collect(task({ status }), waiting), null);
  }
  for (const status of ["todo", "done", "canceled"] as const)
    assert.equal(collect(task(), task({ status, updatedAt: 2 })), null);
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

test("only exact persisted original/merge bindings suppress ordinary session notifications", () => {
  for (const kind of ["api", "acp"] as const) {
    const original = task({
      session: { kind, id: "session" },
      useWorktree: false,
      directBranch: "main",
    });
    assert.ok(isWorkTaskNotificationSession([original], kind, "session", "/project"));
    assert.equal(isWorkTaskNotificationSession([original], kind, "ordinary", "/project"), false);
    assert.equal(isWorkTaskNotificationSession([original], kind, "session", "/other"), false);
    assert.equal(
      isWorkTaskNotificationSession(
        [original],
        kind === "api" ? "acp" : "api",
        "session",
        "/project",
      ),
      false,
    );
    assert.equal(
      isWorkTaskNotificationSession(
        [task({ session: original.session })],
        kind,
        "session",
        "/project",
      ),
      false,
    );
    const isolated = task({ session: original.session, worktree: { path: "/isolated" } as never });
    assert.ok(isWorkTaskNotificationSession([isolated], kind, "session", "/isolated"));
    assert.equal(isWorkTaskNotificationSession([isolated], kind, "session", "/project"), false);
    const merge = task({
      merge: { session: { kind, id: "merge" }, worktree: { path: "/merge" } } as never,
    });
    assert.ok(isWorkTaskNotificationSession([merge], kind, "merge", "/merge"));
    assert.equal(isWorkTaskNotificationSession([merge], kind, "merge", "/project"), false);
  }
});
