import assert from "node:assert/strict";
import test from "node:test";
import { countBoardSidebarItems } from "../src/agent-board/agentBoardSidebarCounts.js";
import {
  boardEntityKey,
  defaultBoardTracking,
  type BoardItem,
  type BoardStagedItems,
} from "../src/agent-board/agentBoardModel.js";

const item = (
  scope: string,
  kind: BoardItem["kind"],
  status: BoardItem["status"],
  patch: Partial<BoardItem> = {},
): BoardItem =>
  ({
    key: boardEntityKey({ workspacePath: "/same", workspaceIdentity: scope }, kind, "same-id"),
    projectKey: scope,
    workspacePath: "/same",
    workspaceIdentity: scope,
    kind,
    status,
    ...(kind === "work-task" ? { workTask: { status: "todo" } } : {}),
    updatedAt: 100,
    archived: false,
    ...patch,
  }) as BoardItem;

test("sidebar counts share board outcomes, tracking, staging and full project identity", () => {
  const stage = item("remote:a", "acp", "error");
  const rows = [
    item("remote:a", "native", "waiting"),
    stage,
    item("remote:a", "work-task", "review"),
    item("remote:b", "native", "completed"),
    item("chat", "acp", "error", { workspacePurpose: "conversation" }),
    item("queued", "work-task", "todo"),
    item("canceled", "work-task", "idle", {
      workTask: { status: "canceled" },
    } as Partial<BoardItem>),
    item("archived", "native", "completed", { archived: true }),
  ];
  const staged = { [stage.key]: { updatedAt: 100, outcome: "error" } } satisfies BoardStagedItems;
  const counts = countBoardSidebarItems(rows, defaultBoardTracking, staged);
  assert.deepEqual(counts.all, { running: 2, completed: 2, staged: 1, error: 2 });
  assert.deepEqual(counts.projects.get("remote:a"), {
    running: 1,
    completed: 1,
    staged: 1,
    error: 0,
  });
  assert.deepEqual(counts.projects.get("remote:b"), {
    running: 0,
    completed: 1,
    staged: 0,
    error: 0,
  });
  assert.deepEqual(counts.standalone, { running: 0, completed: 0, staged: 0, error: 1 });
  assert.deepEqual(counts.workTasks, { running: 1, completed: 1, staged: 0, error: 1 });
  assert.equal(counts.projects.has("archived"), false);
  const tracked = countBoardSidebarItems(
    rows,
    {
      ...defaultBoardTracking,
      mode: "custom",
      projects: ["remote:a"],
      includedItems: [rows[3].key],
      excludedItems: [stage.key],
    },
    staged,
  );
  assert.deepEqual(tracked.all, { running: 1, completed: 1, staged: 0, error: 0 });
});

test("new activity leaves staging and empty scopes keep zero counts", () => {
  const row = item("remote:a", "native", "completed");
  const staged = { [row.key]: { updatedAt: 100, outcome: "completed" } } satisfies BoardStagedItems;
  assert.equal(countBoardSidebarItems([row], defaultBoardTracking, staged).all.staged, 1);
  const resumed = { ...row, status: "running" as const, updatedAt: 200 };
  assert.deepEqual(countBoardSidebarItems([resumed], defaultBoardTracking, staged).all, {
    running: 1,
    completed: 0,
    staged: 0,
    error: 0,
  });
  assert.deepEqual(countBoardSidebarItems([], defaultBoardTracking, {}).all, {
    running: 0,
    completed: 0,
    staged: 0,
    error: 0,
  });
});
