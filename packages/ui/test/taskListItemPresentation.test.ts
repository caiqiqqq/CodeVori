import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { deriveTaskLeadingIndicator } from "../src/lib/taskListItemPresentation.js";
import type { TaskListRowActivity } from "../src/v4/taskListRowActivity.js";

function task(overrides: Partial<ZCodeTaskMeta> = {}): ZCodeTaskMeta {
  return {
    taskId: "task-1",
    traceId: "trace-1",
    title: "Completed conversation",
    workspacePath: "/workspace",
    createdAt: 100,
    updatedAt: 123,
    mode: "auto",
    status: "completed",
    unreadAt: 123,
    ...overrides,
  };
}

test("completed tasks retain an unread indicator when unreadAt is present", () => {
  assert.equal(deriveTaskLeadingIndicator(task(), null), "unread");
});

for (const phase of ["completedSuccess", "completedInterrupted"] as const) {
  test(`${phase} activity retains the completed unread indicator`, () => {
    assert.equal(
      deriveTaskLeadingIndicator(task(), {
        phase,
        lastActivityAt: 123,
        hasBackgroundWork: false,
      }),
      "unread",
    );
  });
}

test("an error indicator takes precedence over completed unread", () => {
  assert.equal(
    deriveTaskLeadingIndicator(task({ status: "error" }), {
      phase: "error",
      lastActivityAt: 123,
      hasBackgroundWork: false,
    } satisfies TaskListRowActivity),
    "error",
  );
});

test("persisted error takes precedence over unread before activity hydrates", () => {
  assert.equal(deriveTaskLeadingIndicator(task({ status: "error" }), null), "error");
});

test("completed activity overrides a persisted error and preserves unread", () => {
  assert.equal(
    deriveTaskLeadingIndicator(task({ status: "error" }), {
      phase: "completedSuccess",
      lastActivityAt: 123,
      hasBackgroundWork: false,
    }),
    "unread",
  );
});

test("completed tasks without unreadAt remain visually neutral", () => {
  assert.equal(deriveTaskLeadingIndicator(task({ unreadAt: undefined }), null), "none");
});
