import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeTaskMeta, ZCodeWorkspaceTaskListChanged } from "@zcode/shared";
import { buildTaskEntityKey } from "../src/lib/taskQueryCache.js";
import { syncTaskUnreadFromStatusWorkspaceEvent } from "../src/lib/taskStatusUnreadSync.js";
import { useZCodeSessionStore, getTaskUnreadIndicator } from "../src/store/zcodeSessionStore.js";
import {
  setTaskQueryCacheUnreadOverlay,
  useTaskQueryCacheStore,
} from "../src/store/taskQueryCacheStore.js";

for (const failed of [false, true]) {
  test(`late background unread ${failed ? "failure" : "success"} cannot undo opening the task`, async () => {
    const target = { workspacePath: `/fixture/unread-${failed}`, taskId: `task-${failed}` };
    const meta = {
      ...target,
      title: "synthetic",
      createdAt: 1,
      updatedAt: 2,
      status: "completed",
      unreadAt: 123,
    } as ZCodeTaskMeta;
    let resolve!: (value: ZCodeTaskMeta) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<ZCodeTaskMeta>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    syncTaskUnreadFromStatusWorkspaceEvent({
      activeWorkspace: { workspacePath: "/different-active-workspace" },
      event: {
        ...target,
        reason: "task_status_changed",
        unreadSignal: "background_terminal",
        taskMeta: { ...meta, unreadAt: undefined },
      } as ZCodeWorkspaceTaskListChanged,
      service: { setTaskUnread: () => pending },
    });
    const key = buildTaskEntityKey(target);
    assert.equal(
      typeof useTaskQueryCacheStore.getState().taskUnreadOverlayByEntityKey[key],
      "number",
    );
    // 同真实打开路径一样，由现有 owner 写已读意图。
    setTaskQueryCacheUnreadOverlay(target, undefined);
    useZCodeSessionStore
      .getState()
      .setTaskUnreadIndicator(target.workspacePath, target.taskId, false);
    if (failed) reject(new Error("synthetic persistence failure"));
    else resolve(meta);
    await new Promise((res) => setImmediate(res));
    assert.equal(useTaskQueryCacheStore.getState().taskUnreadOverlayByEntityKey[key], null);
    assert.equal(
      getTaskUnreadIndicator(
        useZCodeSessionStore.getState().getWorkspaceState(target.workspacePath),
        target.taskId,
      ),
      false,
    );
  });
}

test("background unread response still reconciles when no newer intent exists", async () => {
  const target = { workspacePath: "/fixture/unread-normal", taskId: "task-normal" };
  const meta = {
    ...target,
    title: "synthetic",
    createdAt: 1,
    updatedAt: 2,
    status: "completed",
    unreadAt: 456,
  } as ZCodeTaskMeta;
  syncTaskUnreadFromStatusWorkspaceEvent({
    activeWorkspace: { workspacePath: "/different-active-workspace" },
    event: {
      ...target,
      reason: "task_status_changed",
      unreadSignal: "background_terminal",
      taskMeta: { ...meta, unreadAt: undefined },
    } as ZCodeWorkspaceTaskListChanged,
    service: { setTaskUnread: async () => meta },
  });
  await new Promise((res) => setImmediate(res));
  const key = buildTaskEntityKey(target);
  assert.equal(
    getTaskUnreadIndicator(
      useZCodeSessionStore.getState().getWorkspaceState(target.workspacePath),
      target.taskId,
    ),
    true,
  );
  assert.notEqual(useTaskQueryCacheStore.getState().taskUnreadOverlayByEntityKey[key], null);
});
