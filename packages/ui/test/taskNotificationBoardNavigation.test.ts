import assert from "node:assert/strict";
import test from "node:test";
import {
  boardEntityKey,
  defaultBoardTracking,
  type BoardItem,
} from "../src/agent-board/agentBoardModel.js";
import { findNotificationBoardItem } from "../src/lib/taskNotificationBoardNavigation.js";

const item = (kind: BoardItem["kind"], workspaceIdentity: string, id = "same-id"): BoardItem =>
  ({
    kind,
    key: boardEntityKey({ workspacePath: "/same", workspaceIdentity }, kind, id),
    workspacePath: "/same",
    workspaceIdentity,
    remoteSessionId: workspaceIdentity,
    projectKey: workspaceIdentity,
    workspacePurpose: "project",
    ...(kind === "native" ? { task: { taskId: id } } : {}),
  }) as BoardItem;

test("notification routing matches the exact board entity and tracking rules", () => {
  const native = item("native", "remote:a");
  const acp = item("acp", "remote:a");
  const otherHost = item("native", "remote:b");
  const workTask = item("work-task", "remote:a", "work-1");
  const items = [otherHost, native, acp, workTask];
  const tracking = { ...defaultBoardTracking, mode: "custom" as const, projects: ["remote:a"] };
  assert.equal(
    findNotificationBoardItem(
      { kind: "api", workspacePath: "/same", workspaceIdentity: "remote:a", taskId: "same-id" },
      items,
      tracking,
    ),
    native,
  );
  assert.equal(
    findNotificationBoardItem(
      {
        kind: "acp",
        session: {
          id: "same-id",
          workspacePath: "/same",
          workspaceIdentity: "remote:a",
          remoteSessionId: "remote:a",
        } as never,
      },
      items,
      tracking,
    ),
    acp,
  );
  assert.equal(
    findNotificationBoardItem(
      {
        kind: "work-task",
        scope: {
          workspacePath: "/same",
          workspaceIdentity: "remote:a",
          remoteSessionId: "remote:a",
        },
        id: "work-1",
      },
      items,
      tracking,
    ),
    undefined,
    "work tasks require their own tracking rule",
  );
  assert.equal(
    findNotificationBoardItem(
      { kind: "api", workspacePath: "/same", workspaceIdentity: "remote:b", taskId: "same-id" },
      items,
      tracking,
    ),
    undefined,
  );
  assert.equal(
    findNotificationBoardItem(
      { kind: "api", workspacePath: "/same", workspaceIdentity: "remote:a", taskId: "missing" },
      items,
      tracking,
    ),
    undefined,
  );
  assert.equal(
    findNotificationBoardItem(
      { kind: "api", workspacePath: "/same", workspaceIdentity: "remote:a", taskId: "same-id" },
      items,
      { ...tracking, excludedItems: [native.key] },
    ),
    undefined,
  );
  assert.equal(
    findNotificationBoardItem(
      {
        kind: "work-task",
        scope: {
          workspacePath: "/same",
          workspaceIdentity: "remote:a",
          remoteSessionId: "remote:a",
        },
        id: "work-1",
      },
      items,
      { ...tracking, workTasks: true },
    ),
    workTask,
  );
  assert.equal(
    findNotificationBoardItem({ kind: "api-notification", taskId: "same-id" }, [native], tracking),
    native,
  );
  assert.equal(
    findNotificationBoardItem(
      { kind: "api-notification", taskId: "same-id" },
      [native, otherHost],
      defaultBoardTracking,
    ),
    undefined,
    "unscoped legacy IDs must not select an arbitrary workspace",
  );
});
