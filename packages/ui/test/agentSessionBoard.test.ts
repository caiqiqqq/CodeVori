import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeBoardStatus,
  workTaskBoardStatus,
  acpBoardStatus,
  boardEntityKey,
  matchesBoardTracking,
  type BoardItem,
  type BoardTracking,
} from "../src/agent-board/agentBoardModel.js";
import { createAgentBoardStore } from "../src/store/agentBoardStore.js";

test("turn outcomes do not complete work, explicit review expires on new activity", () => {
  const task: any = { updatedAt: 100, status: "completed", liveStatus: "completed" };
  assert.equal(nativeBoardStatus(task), "idle");
  assert.equal(nativeBoardStatus({ ...task, boardCompletedAt: 100 }), "completed");
  assert.equal(nativeBoardStatus({ ...task, updatedAt: 101, boardCompletedAt: 100 }), "idle");
  assert.equal(
    nativeBoardStatus({ ...task, liveStatus: "waiting", boardCompletedAt: 100 }),
    "waiting",
  );
  assert.equal(
    nativeBoardStatus({
      ...task,
      activity: { phase: "completedSuccess", hasBackgroundWork: true },
    }),
    "running",
  );
  assert.equal(
    acpBoardStatus({ status: "idle", updatedAt: 100, boardCompletedAt: 100 } as any),
    "completed",
  );
  assert.equal(
    acpBoardStatus({ status: "running", waiting: true, updatedAt: 100 } as any),
    "waiting",
  );
  assert.equal(acpBoardStatus({ status: "interrupted", failed: true } as any), "error");
  assert.equal(
    nativeBoardStatus({ ...task, liveStatus: "error", boardCompletedAt: 100 }),
    "completed",
  );
  assert.equal(
    acpBoardStatus({
      status: "interrupted",
      failed: true,
      updatedAt: 100,
      boardCompletedAt: 100,
    } as any),
    "completed",
  );
});

test("tracking distinguishes standalone tasks and project scopes with exact entity overrides", () => {
  const scope = { workspacePath: "/same", workspaceIdentity: "remote:a" };
  const item = {
    ...scope,
    key: boardEntityKey(scope, "native", "1"),
    projectKey: "project-a",
  } as BoardItem;
  const selection: BoardTracking = {
    mode: "custom",
    projects: [],
    standalone: false,
    workTasks: false,
    includedItems: [],
    excludedItems: [],
  };
  assert.equal(matchesBoardTracking(item, selection), false);
  assert.equal(matchesBoardTracking(item, { ...selection, projects: ["project-a"] }), true);
  const standalone = { ...item, workspacePurpose: "conversation" as const };
  assert.equal(matchesBoardTracking(standalone, { ...selection, projects: ["project-a"] }), false);
  assert.equal(matchesBoardTracking(standalone, { ...selection, standalone: true }), true);
  assert.equal(matchesBoardTracking(item, { ...selection, includedItems: [item.key] }), true);
  assert.equal(
    matchesBoardTracking(item, {
      ...selection,
      projects: ["project-a"],
      excludedItems: [item.key],
    }),
    false,
  );
  const acp = { ...item, key: boardEntityKey(scope, "acp", "1") };
  assert.equal(matchesBoardTracking(acp, { ...selection, includedItems: [item.key] }), false);
  const remoteB = {
    ...item,
    key: boardEntityKey({ ...scope, workspaceIdentity: "remote:b" }, "native", "1"),
  };
  assert.equal(matchesBoardTracking(remoteB, { ...selection, includedItems: [item.key] }), false);
  assert.equal(matchesBoardTracking(item, { ...selection, mode: "all" }), true);
});

test("tracking and standalone category persist without losing temporarily absent scopes; old preferences migrate", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const store = createAgentBoardStore(storage);
  const tracking: BoardTracking = {
    mode: "custom",
    projects: ["closed-project"],
    standalone: false,
    workTasks: false,
    includedItems: ["remote-item"],
    excludedItems: ["hidden-item"],
  };
  store.getState().setTracking(tracking);
  store.getState().selectStandalone();
  const restored = createAgentBoardStore(storage);
  assert.deepEqual(restored.getState().tracking, tracking);
  assert.equal(restored.getState().category, "standalone");
  restored.getState().selectProject("project-a");
  assert.equal(restored.getState().category, "all");
  const legacy = JSON.parse(values.get("zcode-agent-board:v1")!);
  delete legacy.tracking;
  delete legacy.category;
  values.set("zcode-agent-board:v1", JSON.stringify(legacy));
  assert.equal(createAgentBoardStore(storage).getState().tracking.mode, "all");
  legacy.tracking = { mode: "custom", projects: [42] };
  values.set("zcode-agent-board:v1", JSON.stringify(legacy));
  const recovered = createAgentBoardStore(storage).getState();
  assert.equal(recovered.tracking.mode, "all");
  assert.equal(recovered.project, "project-a");
});
test("entity keys isolate same id by kind and workspace identity", () => {
  const scope = { workspacePath: "/same", workspaceIdentity: "remote:a" };
  assert.notEqual(boardEntityKey(scope, "native", "1"), boardEntityKey(scope, "acp", "1"));
  assert.notEqual(
    boardEntityKey(scope, "native", "1"),
    boardEntityKey({ ...scope, workspaceIdentity: "remote:b" }, "native", "1"),
  );
});
test("display preferences persist, pin limit is enforced, corrupt state recovers", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  };
  const store = createAgentBoardStore(storage);
  for (let i = 0; i < 8; i++) store.getState().toggleProject(`project-${i}`);
  assert.equal(store.getState().pinnedProjects?.length, 6);
  store.getState().selectProject("remote:a");
  store.getState().setView("attention");
  const restored = createAgentBoardStore(storage);
  assert.equal(restored.getState().project, "remote:a");
  assert.equal(restored.getState().view, "attention");
  store.getState().toggleProject("project-0");
  store.getState().toggleProject("new");
  assert.equal(store.getState().pinnedProjects?.length, 6);
  values.set("zcode-agent-board:v1", "broken");
  assert.equal(createAgentBoardStore(storage).getState().project, null);
});

test("Agent board navigation has its own history entry and preserves remote identity", async () => {
  const { createTaskNavigationHistory, pushNavEntry, pushAgentBoardNavEntry, goBack, goForward } =
    await import("../src/lib/taskNavigationHistory.js");
  let history = pushNavEntry(createTaskNavigationHistory(), "/same", "native", "remote:a");
  history = pushAgentBoardNavEntry(history, "/same", "remote:a");
  assert.equal(pushAgentBoardNavEntry(history, "/same", "remote:a"), history);
  assert.equal(goBack(history)?.entry.kind, "task");
  assert.deepEqual(goForward(goBack(history)!.history)?.entry, {
    kind: "agent-board",
    workspacePath: "/same",
    workspaceIdentity: "remote:a",
  });
});

test("work tasks retain lifecycle and have an independent tracking group", () => {
  const task = { status: "review" } as any;
  for (const [status, expected] of Object.entries({
    todo: "todo",
    queued: "todo",
    preparing: "running",
    running: "running",
    awaiting_input: "waiting",
    review: "review",
    failed: "error",
    done: "completed",
    canceled: "idle",
  }))
    assert.equal(workTaskBoardStatus({ ...task, status }), expected);
  assert.equal(
    workTaskBoardStatus({ ...task, status: "awaiting_input", merge: { phase: "awaiting_input" } }),
    "waiting",
  );
  const item = {
    kind: "work-task",
    key: boardEntityKey({ workspacePath: "/p" }, "work-task", "1"),
    projectKey: "/p",
  } as BoardItem;
  const tracking: BoardTracking = {
    mode: "custom",
    projects: ["/p"],
    standalone: true,
    workTasks: false,
    includedItems: [],
    excludedItems: [],
  };
  assert.equal(matchesBoardTracking(item, tracking), false);
  assert.equal(matchesBoardTracking(item, { ...tracking, workTasks: true }), true);
  assert.equal(
    matchesBoardTracking(item, { ...tracking, workTasks: true, excludedItems: [item.key] }),
    false,
  );
  assert.equal(matchesBoardTracking(item, { ...tracking, includedItems: [item.key] }), true);
  assert.notEqual(item.key, boardEntityKey({ workspacePath: "/p" }, "native", "1"));
});

test("legacy custom tracking preserves choices while new work tasks default to unselected", () => {
  const raw = JSON.stringify({
    project: null,
    pinnedProjects: null,
    view: "all",
    group: "status",
    agent: "all",
    search: "",
    category: "standalone",
    tracking: {
      mode: "custom",
      projects: ["/p"],
      standalone: true,
      includedItems: ["keep"],
      excludedItems: ["hide"],
    },
  });
  const store = createAgentBoardStore({ getItem: () => raw, setItem() {}, removeItem() {} });
  assert.deepEqual(store.getState().tracking, {
    mode: "custom",
    projects: ["/p"],
    standalone: true,
    workTasks: false,
    includedItems: ["keep"],
    excludedItems: ["hide"],
  });
  store.getState().selectWorkTasks();
  assert.equal(store.getState().category, "work-tasks");
  assert.equal(store.getState().project, null);
});
