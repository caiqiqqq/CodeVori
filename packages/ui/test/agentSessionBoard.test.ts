import test from "node:test";
import assert from "node:assert/strict";
import {
  canStageBoardItem,
  isBoardItemStaged,
  nativeBoardStatus,
  workTaskBoardStatus,
  acpBoardStatus,
  boardEntityKey,
  matchesBoardTracking,
  matchesBoardView,
  BOARD_STATUSES,
  boardDisplayStatus,
  boardResultTimestamp,
  compareBoardItems,
  boardHasUnreadResult,
  workTaskResultToken,
  boardStatusIndicator,
  BOARD_DISPLAY_STATUSES,
  type BoardItem,
  type BoardTracking,
} from "../src/agent-board/agentBoardModel.js";
import { createAgentBoardStore } from "../src/store/agentBoardStore.js";

test("custom status order persists and invalid orders only reset that preference", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  assert.deepEqual(store.getState().statusOrder, BOARD_DISPLAY_STATUSES);
  store.getState().setSearch("keep search");
  const custom = ["error", "staged", "running", "completed"] as const;
  store.getState().setStatusOrder(custom);
  assert.deepEqual(createAgentBoardStore(storage).getState().statusOrder, custom);
  for (const invalid of [
    null,
    ["running"],
    ["running", "running", "staged", "error"],
    ["running", "completed", "staged", "unknown"],
  ]) {
    const saved = JSON.parse(raw!);
    raw = JSON.stringify({ ...saved, statusOrder: invalid });
    const restored = createAgentBoardStore(storage).getState();
    assert.deepEqual(restored.statusOrder, BOARD_DISPLAY_STATUSES);
    assert.equal(restored.search, "keep search");
  }
  const legacy = JSON.parse(raw!);
  delete legacy.statusOrder;
  raw = JSON.stringify(legacy);
  assert.deepEqual(createAgentBoardStore(storage).getState().statusOrder, BOARD_DISPLAY_STATUSES);
  store.getState().setStatusOrder(BOARD_DISPLAY_STATUSES);
  assert.deepEqual(createAgentBoardStore(storage).getState().statusOrder, BOARD_DISPLAY_STATUSES);
});

test("status views separate ongoing, completed, failed and archived work", () => {
  for (const status of BOARD_STATUSES) {
    const item = { status, archived: false } as BoardItem;
    assert.equal(matchesBoardView(item, "active"), status !== "completed" && status !== "error");
    assert.equal(matchesBoardView(item, "completed"), status === "completed");
    assert.equal(matchesBoardView(item, "failed"), status === "error");
    for (const view of ["active", "completed", "failed"] as const)
      assert.equal(matchesBoardView({ ...item, archived: true }, view), false);
  }
  assert.deepEqual(BOARD_DISPLAY_STATUSES, ["running", "completed", "staged", "error"]);
  const canceled = {
    kind: "work-task",
    status: "idle",
    archived: false,
    workTask: { status: "canceled" },
  } as BoardItem;
  assert.equal(boardDisplayStatus(canceled), "error");
  assert.equal(matchesBoardView(canceled, "failed"), true);
  assert.equal(matchesBoardView(canceled, "active"), false);
  assert.equal(boardDisplayStatus({ kind: "native", status: "idle" } as BoardItem), "running");
});

test("new preferences use status columns and new status views restore saved grouping", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  assert.equal(store.getState().group, "status");
  store.getState().setGroup("project");
  for (const view of ["completed", "failed"] as const) {
    store.getState().setView(view);
    const restored = createAgentBoardStore(storage).getState();
    assert.equal(restored.view, view);
    assert.equal(restored.group, "project");
  }
});

test("legacy starred view migrates to all without resetting board preferences", () => {
  const preferences = {
    layoutVersion: 2,
    project: "/project",
    pinnedProjects: ["/project"],
    view: "starred",
    group: "project",
    agent: "codex",
    search: "keep search",
    category: "work-tasks",
    tracking: {
      mode: "custom",
      projects: ["/project"],
      standalone: true,
      workTasks: true,
      includedItems: ["keep"],
      excludedItems: ["hide"],
    },
    stagedItems: { staged: { updatedAt: 100, outcome: "completed" } },
    readWorkTaskResults: { result: "[1,100]" },
  };
  const state = createAgentBoardStore({
    getItem: () => JSON.stringify(preferences),
    setItem() {},
    removeItem() {},
  }).getState();
  for (const [key, value] of Object.entries(preferences)) {
    if (key === "layoutVersion") continue;
    assert.deepEqual(state[key as keyof typeof state], key === "view" ? "all" : value, key);
  }
});

test("legacy project layout migrates without discarding scope; all-project navigation restores status layout", () => {
  let raw = JSON.stringify({
    project: null,
    pinnedProjects: ["/project"],
    view: "failed",
    group: "project",
    agent: "codex",
    search: "fix",
    category: "all",
    tracking: {
      mode: "custom",
      projects: ["/project"],
      standalone: true,
      workTasks: true,
      includedItems: ["include"],
      excludedItems: ["exclude"],
    },
  });
  const legacy = JSON.parse(raw);
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  assert.equal(store.getState().group, "status");
  for (const field of [
    "project",
    "pinnedProjects",
    "view",
    "agent",
    "search",
    "category",
    "tracking",
  ] as const)
    assert.deepEqual(store.getState()[field], legacy[field]);
  store.getState().setGroup("project");
  assert.equal(
    createAgentBoardStore(storage).getState().group,
    "project",
    "explicit grouping after migration persists",
  );
  for (const select of [
    () => store.getState().selectProject("/project"),
    () => store.getState().selectWorkTasks(),
    () => store.getState().selectStandalone(),
  ]) {
    select();
    store.getState().setGroup("project");
    store.getState().selectProject(null);
    const restored = createAgentBoardStore(storage).getState();
    assert.equal(restored.project, null);
    assert.equal(restored.category, "all");
    assert.equal(restored.group, "status");
    assert.deepEqual(restored.tracking, legacy.tracking);
  }
});

test("conversation outcomes drive completion without manual confirmation", () => {
  const task: any = { updatedAt: 100, status: "completed", liveStatus: "completed" };
  assert.equal(nativeBoardStatus(task), "completed");
  assert.equal(nativeBoardStatus({ ...task, liveStatus: "idle" }), "completed");
  assert.equal(
    nativeBoardStatus({ ...task, activity: { phase: "completedSuccess" } }),
    "completed",
  );
  assert.equal(acpBoardStatus({ status: "idle", updatedAt: 100 } as any), "completed");
  for (const marker of [undefined, 100, 1000]) {
    assert.equal(nativeBoardStatus({ ...task, boardCompletedAt: marker }), "completed");
    assert.equal(
      nativeBoardStatus({ ...task, liveStatus: "running", boardCompletedAt: marker }),
      "running",
    );
    assert.equal(
      nativeBoardStatus({ ...task, liveStatus: "waiting", boardCompletedAt: marker }),
      "waiting",
    );
    assert.equal(
      nativeBoardStatus({ ...task, liveStatus: "error", boardCompletedAt: marker }),
      "error",
    );
    assert.equal(
      acpBoardStatus({ status: "interrupted", boardCompletedAt: marker } as any),
      "error",
    );
    assert.equal(acpBoardStatus({ status: "running", boardCompletedAt: marker } as any), "running");
  }
  assert.equal(
    nativeBoardStatus({
      ...task,
      activity: { phase: "completedSuccess", hasBackgroundWork: true },
    }),
    "running",
  );
  assert.equal(acpBoardStatus({ status: "running", waiting: true } as any), "waiting");
});

test("interrupted conversations leave ongoing even without a sidebar error", () => {
  const acp = { status: "interrupted", failed: false, updatedAt: 101 } as any;
  const native = {
    updatedAt: 101,
    liveStatus: "completed",
    activity: { phase: "completedInterrupted", hasBackgroundWork: false },
  } as any;
  for (const failed of [false, true]) assert.equal(acpBoardStatus({ ...acp, failed }), "error");
  assert.equal(nativeBoardStatus(native), "error");
  for (const [source, project] of [
    [acp, acpBoardStatus],
    [native, nativeBoardStatus],
  ] as const) {
    const status = project(source);
    const item = { status, archived: false } as BoardItem;
    assert.equal(boardDisplayStatus(item), "error");
    assert.equal(matchesBoardView(item, "active"), false);
    assert.equal(matchesBoardView(item, "failed"), true);
    assert.equal(matchesBoardView(item, "completed"), false);
    assert.equal(matchesBoardView({ ...item, archived: true }, "failed"), false);
    assert.equal(matchesBoardView({ ...item, archived: true }, "archived"), true);
    assert.equal(project({ ...source, boardCompletedAt: 101 }), "error");
    assert.equal(project({ ...source, boardCompletedAt: 100 }), "error");
  }
  assert.equal(acpBoardStatus({ ...acp, status: "running", boardCompletedAt: 101 }), "running");
  assert.equal(acpBoardStatus({ ...acp, waiting: true }), "waiting");
  assert.equal(nativeBoardStatus({ ...native, liveStatus: "running" }), "running");
  assert.equal(nativeBoardStatus({ ...native, liveStatus: "waiting" }), "waiting");
  assert.equal(
    nativeBoardStatus({ ...native, activity: { ...native.activity, hasBackgroundWork: true } }),
    "running",
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
  assert.equal(restored.getState().view, "all");
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

test("finished work-task execution is completed on the board before acceptance", () => {
  for (const status of ["review", "done"] as const) {
    const workTask = { status } as any;
    const item = {
      kind: "work-task",
      status: workTaskBoardStatus(workTask),
      workTask,
    } as BoardItem;
    assert.equal(boardDisplayStatus(item), "completed");
    assert.equal(matchesBoardView(item, "active"), false);
    assert.equal(matchesBoardView(item, "completed"), true);
  }
  const workTask = {
    status: "done",
    forgeWriteback: { commentState: "pending", closeState: "done" },
  } as any;
  assert.equal(workTaskBoardStatus(workTask), "review");
  assert.equal(
    boardDisplayStatus({ kind: "work-task", status: "review", workTask } as BoardItem),
    "completed",
  );
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

test("staging only accepts terminal cards and preserves their raw outcome", () => {
  for (const status of BOARD_STATUSES) {
    const item = { key: "a", kind: "native", status, updatedAt: 100, archived: false } as BoardItem;
    assert.equal(canStageBoardItem(item), status === "completed" || status === "error");
    assert.equal(canStageBoardItem({ ...item, archived: true }), false);
  }
  for (const status of ["completed", "error", "review", "idle"] as const) {
    const item = {
      key: "a",
      kind: "work-task",
      status,
      updatedAt: 100,
      workTask: { status: status === "idle" ? "canceled" : "review" },
    } as BoardItem;
    assert.equal(canStageBoardItem(item), true);
    const staged = { ...item, staged: true };
    assert.equal(boardDisplayStatus(staged), "staged");
    assert.equal(matchesBoardView(staged, "staged"), true);
    assert.equal(matchesBoardView(staged, "completed"), false);
    assert.equal(matchesBoardView(staged, "failed"), false);
    assert.equal(matchesBoardView({ ...staged, archived: true }, "staged"), false);
    assert.equal(staged.status, status);
  }
});

test("staging persists with identity isolation and is cleared by observed new activity", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  const item = {
    key: boardEntityKey({ workspacePath: "/p", workspaceIdentity: "remote:a" }, "native", "1"),
    kind: "native",
    status: "completed",
    updatedAt: 100,
    archived: false,
  } as BoardItem;
  store.getState().setItemStaged(item, true);
  store.getState().setView("staged");
  const restored = createAgentBoardStore(storage);
  assert.equal(restored.getState().view, "staged");
  assert.equal(isBoardItemStaged(item, restored.getState().stagedItems), true);
  for (const other of [
    {
      ...item,
      key: boardEntityKey({ workspacePath: "/p", workspaceIdentity: "remote:b" }, "native", "1"),
    },
    {
      ...item,
      key: boardEntityKey({ workspacePath: "/p", workspaceIdentity: "remote:a" }, "acp", "1"),
    },
    { ...item, updatedAt: 101 },
    { ...item, status: "error" as const },
    { ...item, archived: true },
  ])
    assert.equal(isBoardItemStaged(other, restored.getState().stagedItems), false);
  restored.getState().reconcileStagedItems([]);
  assert.equal(isBoardItemStaged(item, restored.getState().stagedItems), true);
  restored.getState().reconcileStagedItems([{ ...item, status: "running" }]);
  assert.equal(
    isBoardItemStaged(item, restored.getState().stagedItems),
    false,
    "old staging cannot return after a new run",
  );
  restored.getState().setItemStaged({ ...item, status: "running" }, true);
  assert.deepEqual(restored.getState().stagedItems, {}, "reject stale drop on running card");
  restored.getState().setItemStaged(item, true);
  restored.getState().setItemStaged(item, false);
  assert.deepEqual(restored.getState().stagedItems, {});
  for (const malformed of [
    undefined,
    [],
    { a: { updatedAt: "bad", outcome: "completed" } },
    { a: { updatedAt: 100, outcome: "running" } },
  ]) {
    raw = JSON.stringify({ ...JSON.parse(raw!), stagedItems: malformed, search: "keep" });
    const recovered = createAgentBoardStore(storage).getState();
    assert.deepEqual(recovered.stagedItems, {});
    assert.equal(recovered.search, "keep");
  }
});

test("ongoing indicators distinguish waiting without changing columns or staging admission", () => {
  for (const status of [
    "todo",
    "queued",
    "awaiting_input",
    "preparing",
    "running",
    "review",
    "done",
    "failed",
    "canceled",
  ] as const) {
    const workTask = { status } as any;
    const item = {
      kind: "work-task",
      workTask,
      status: workTaskBoardStatus(workTask),
      archived: false,
    } as BoardItem;
    const waiting = ["todo", "queued", "awaiting_input"].includes(status);
    assert.equal(boardStatusIndicator(item), waiting ? "waiting" : boardDisplayStatus(item));
    if (waiting) {
      assert.equal(boardDisplayStatus(item), "running");
      assert.equal(matchesBoardView(item, "active"), true);
      assert.equal(canStageBoardItem(item), false);
      assert.equal(boardStatusIndicator({ ...item, staged: true }), "waiting");
    }
  }
  for (const task of [
    { liveStatus: "waiting" },
    { liveStatus: "running", pendingInteraction: { kind: "permission" } },
    {
      liveStatus: "running",
      activity: {
        hasBackgroundWork: true,
        pendingInteractions: { permissionCount: 1, userInputCount: 0 },
      },
    },
    {
      liveStatus: "running",
      activity: { pendingInteractions: { permissionCount: 0, userInputCount: 1 } },
    },
  ]) {
    const status = nativeBoardStatus(task as any);
    assert.equal(boardStatusIndicator({ kind: "native", status } as BoardItem), "waiting");
  }
  for (const status of ["running", "idle", "interrupted"] as const) {
    const session = { status, waiting: true } as any;
    const item = { kind: "acp", status: acpBoardStatus(session) } as BoardItem;
    assert.equal(boardStatusIndicator(item), "waiting");
    assert.equal(matchesBoardView(item, "active"), true);
    assert.equal(canStageBoardItem(item), false);
  }
  const base = { kind: "native", status: "running" } as BoardItem;
  assert.equal(boardStatusIndicator(base), "running");
  for (const status of ["completed", "error"] as const) {
    const terminal = { ...base, status };
    assert.equal(boardStatusIndicator(terminal), status);
    assert.equal(boardStatusIndicator({ ...terminal, staged: true }), "staged");
  }
});

test("result order uses completion rather than metadata or read time", () => {
  const older = {
    key: "a",
    kind: "native",
    status: "completed",
    completedAt: 100,
    updatedAt: 900,
    task: { unreadAt: 100 },
  } as BoardItem;
  const newer = { ...older, key: "b", completedAt: 200, updatedAt: 500 };
  assert.deepEqual(
    [older, newer].sort(compareBoardItems).map((i) => i.key),
    ["b", "a"],
  );
  assert.equal(boardResultTimestamp(older), 100);
  assert.equal(boardResultTimestamp({ ...older, status: "running" }), 900);
  assert.equal(boardResultTimestamp({ ...older, completedAt: undefined }), 900);
  assert.equal(boardHasUnreadResult(older, {}), true);
  assert.equal(
    boardHasUnreadResult({ ...older, task: { unreadAt: undefined } } as BoardItem, {}),
    false,
  );
  assert.equal(boardHasUnreadResult({ ...older, archived: true }, {}), false);
  assert.equal(boardHasUnreadResult({ ...older, status: "waiting" }, {}), false);
  assert.equal(boardHasUnreadResult({ ...older, staged: true }, {}), true);
});

test("work-task reading persists per result and never accepts a newer result", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  const item = {
    key: "work-a",
    kind: "work-task",
    status: "review",
    archived: false,
    workTask: { status: "review", runSeq: 1, finishedAt: 100 },
  } as BoardItem;
  assert.equal(boardHasUnreadResult(item, {}), true);
  store.getState().markWorkTaskResultRead(item);
  const read = createAgentBoardStore(storage).getState().readWorkTaskResults;
  assert.equal(read[item.key], workTaskResultToken(item.workTask));
  assert.equal(
    boardHasUnreadResult(
      {
        ...item,
        status: "completed",
        workTask: { ...item.workTask, status: "done", updatedAt: 900 },
      },
      read,
    ),
    false,
  );
  const next = { ...item, workTask: { ...item.workTask, runSeq: 2, finishedAt: 200 } };
  assert.equal(boardHasUnreadResult(next, read), true);
  assert.equal(boardHasUnreadResult({ ...item, key: "work-b" }, read), true);
  store.getState().markWorkTaskResultRead(item);
  assert.equal(boardHasUnreadResult(next, store.getState().readWorkTaskResults), true);
  raw = JSON.stringify({ ...JSON.parse(raw!), readWorkTaskResults: { a: 1 }, search: "keep" });
  const recovered = createAgentBoardStore(storage).getState();
  assert.deepEqual(recovered.readWorkTaskResults, {});
  assert.equal(recovered.search, "keep");
});
