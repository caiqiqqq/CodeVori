import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeTaskMeta } from "@zcode/shared";
import type { WorkspaceZCodeUIState } from "../src/store/zcodeSessionStoreTypes.ts";
import { countAllUnreadTasks } from "../src/lib/unreadTaskCount.ts";

function task(taskId: string, unreadAt?: number): ZCodeTaskMeta {
  return {
    taskId,
    traceId: taskId,
    title: taskId,
    workspacePath: "/project",
    createdAt: 1,
    updatedAt: 1,
    mode: "auto",
    unreadAt,
  };
}

function workspace(
  taskListCache: WorkspaceZCodeUIState["taskListCache"],
  taskUnreadByTaskId: Record<string, boolean>,
): Pick<
  WorkspaceZCodeUIState,
  "taskListCache" | "optimisticTaskListByTaskId" | "taskUnreadByTaskId"
> {
  return { taskListCache, optimisticTaskListByTaskId: {}, taskUnreadByTaskId };
}

test("unread compatibility flag counts before a completed task reaches the visible list", () => {
  const state = workspace([task("already-listed")], { "just-completed": true, ignored: false });
  assert.equal(countAllUnreadTasks({ "/project": state }), 1);
});

test("visible task unread flag and unreadAt count once", () => {
  const state = workspace([task("completed")], { completed: true });
  assert.equal(countAllUnreadTasks({ "/project": state }), 1);
  state.taskListCache![0]!.unreadAt = 123;
  assert.equal(countAllUnreadTasks({ "/project": state, alias: state }), 1);
});
