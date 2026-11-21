import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkTask, ZCodeTaskMeta } from "@zcode/shared";
import type { AcpSidebarSession } from "../src/lib/acpSidebarSessions.js";
import { attachTaskListRowActivity } from "../src/v4/taskListRowActivity.js";
import { compareZCodeTaskListItems } from "../src/lib/taskListOrdering.js";
import {
  buildSidebarConversationRows,
  sidebarConversationKey,
  sidebarWorkTasksForScopes,
  workTaskBoundConversationKeys,
} from "../src/lib/sidebarConversationRows.js";

const todo: WorkTask = {
  workspacePath: "/project",
  id: "todo",
  title: "Pending",
  prompt: "Review",
  execution: {
    kind: "api",
    modelSelection: { providerId: "api", modelId: "model" },
    mode: "build",
  },
  status: "todo",
  archived: false,
  runSeq: 0,
  runText: "Review",
  commandId: "cmd",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  stopPending: false,
  createdAt: 10,
  updatedAt: 40,
};
const native = (overrides: Partial<ZCodeTaskMeta> = {}): ZCodeTaskMeta => ({
  taskId: "session",
  workspacePath: "/project",
  title: "Conversation",
  status: "idle",
  provider: "api",
  model: "api/model",
  createdAt: 5,
  updatedAt: 20,
  ...overrides,
});
const acp: AcpSidebarSession = {
  id: "acp",
  workspacePath: "/project",
  title: "ACP",
  agent: "codex",
  status: "ready",
  createdAt: 8,
  updatedAt: 30,
};
const bound: WorkTask = {
  ...todo,
  useWorktree: false,
  directBranch: "main",
  session: { kind: "api", id: "session" },
};

test("API, ACP and unstarted tasks are interleaved without mutating their sources", () => {
  const rows = buildSidebarConversationRows({
    native: [native()],
    acp: [acp],
    workTasks: [todo],
    boundKeys: new Set(),
    sortBy: "updated",
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["work-task", "acp", "native"],
  );
  assert.equal(rows[0].item, todo);
  assert.equal(todo.session, undefined);
});

test("saved API binding is deduplicated only by exact execution address", () => {
  const keys = workTaskBoundConversationKeys([bound]);
  const rows = buildSidebarConversationRows({
    native: [
      native(),
      native({ workspacePath: "/other" }),
      native({ workspaceIdentity: "remote-project", remoteSessionId: "attachment" }),
    ],
    acp: [{ ...acp, id: "session" }],
    workTasks: [bound],
    boundKeys: keys,
    sortBy: "updated",
  });
  assert.equal(rows.filter((row) => row.kind === "native").length, 2);
  assert.equal(rows.filter((row) => row.kind === "acp").length, 1);
  assert.equal(rows.filter((row) => row.kind === "work-task").length, 1);
});

test("ACP Agent is part of the binding and unallocated or remote tasks hide nothing", () => {
  const task: WorkTask = {
    ...bound,
    session: { kind: "acp", id: "acp" },
    execution: { kind: "acp", agent: "codex", config: [] },
  };
  const keys = workTaskBoundConversationKeys([task]);
  assert.ok(keys.has(sidebarConversationKey({ ...acp, kind: "acp" })));
  assert.ok(!keys.has(sidebarConversationKey({ ...acp, kind: "acp", agent: "claude" })));
  for (const pending of [
    todo,
    { ...bound, directBranch: undefined },
    { ...bound, workspaceIdentity: "remote" },
    { ...bound, remoteSessionId: "remote" },
  ])
    assert.equal(workTaskBoundConversationKeys([pending]).size, 0);
});

test("archived owners hide their bindings while completed unarchived tasks remain", () => {
  const archived = { ...bound, archived: true };
  const rows = buildSidebarConversationRows({
    native: [native()],
    acp: [],
    workTasks: [archived, { ...todo, id: "done", status: "done" }],
    boundKeys: workTaskBoundConversationKeys([archived]),
    sortBy: "updated",
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["work-task"],
  );
  assert.equal((rows[0].item as WorkTask).id, "done");
});

test("scope selection respects identity and attachment instead of matching paths alone", () => {
  const remote = { ...todo, workspaceIdentity: "remote", remoteSessionId: "attachment" };
  assert.deepEqual(sidebarWorkTasksForScopes([todo, remote], [{ workspacePath: "/project" }]), [
    todo,
  ]);
  assert.deepEqual(
    sidebarWorkTasksForScopes([todo, remote], [{ ...remote, remoteSessionId: "other" }]),
    [],
  );
  assert.deepEqual(sidebarWorkTasksForScopes([todo, remote], [remote]), [remote]);
});

test("running rows keep stable positions across streamed updatedAt changes", () => {
  const running: WorkTask = { ...todo, status: "running", createdAt: 1 };
  const input = {
    native: [
      attachTaskListRowActivity(native(), {
        phase: "running",
        lastActivityAt: 20,
        hasBackgroundWork: false,
      }),
    ],
    acp: [],
    boundKeys: new Set<string>(),
    sortBy: "updated" as const,
  };
  assert.deepEqual(
    buildSidebarConversationRows({ ...input, workTasks: [running] }).map((row) => row.key),
    buildSidebarConversationRows({ ...input, workTasks: [{ ...running, updatedAt: 999 }] }).map(
      (row) => row.key,
    ),
  );
});

test("worktree and merge bindings hide only their saved session addresses", () => {
  const worktree = {
    rootPath: "/trees",
    path: "/trees/run",
    projectPath: "/project",
    branchName: "task/run",
    baseCommit: "abc",
  };
  const task: WorkTask = {
    ...todo,
    session: { kind: "api", id: "session" },
    worktree,
    merge: {
      id: "00000000-0000-4000-8000-000000000002",
      projectPath: "/project",
      targetBranch: "main",
      phase: "resolving",
      worktree: { ...worktree, path: "/trees/merge" },
      session: { kind: "api", id: "merge-session" },
    },
  };
  const rows = buildSidebarConversationRows({
    native: [
      native(),
      native({ workspacePath: "/trees/run" }),
      native({ workspacePath: "/trees/merge", taskId: "merge-session" }),
      native({ workspacePath: "/trees/run", taskId: "old-session" }),
    ],
    acp: [],
    workTasks: [task],
    boundKeys: workTaskBoundConversationKeys([task]),
    sortBy: "updated",
  });
  assert.deepEqual(
    rows
      .filter((row) => row.kind === "native")
      .map((row) => row.key)
      .sort(),
    [
      sidebarConversationKey({ ...native(), kind: "native", id: "session" }),
      sidebarConversationKey({
        ...native(),
        workspacePath: "/trees/run",
        kind: "native",
        id: "old-session",
      }),
    ].sort(),
  );
});

test("native creation and update preferences preserve their existing tie ordering", () => {
  const tasks = [
    native({ taskId: "a", updatedAt: 5 }),
    native({ taskId: "z", updatedAt: 5 }),
    native({ taskId: "b", updatedAt: 10 }),
    native({ taskId: "c", createdAt: 1 }),
  ];
  for (const sortBy of ["created", "updated"] as const) {
    assert.deepEqual(
      buildSidebarConversationRows({
        native: tasks,
        acp: [],
        workTasks: [],
        boundKeys: new Set(),
        sortBy,
      }).map((row) => row.item),
      [...tasks].sort((a, b) => compareZCodeTaskListItems(a, b, sortBy)),
    );
  }
});
