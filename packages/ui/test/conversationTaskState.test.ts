import assert from "node:assert/strict";
import test from "node:test";
import type { WorkTask, ZCodeTaskMeta } from "@zcode/shared";
import type { AcpSidebarSession } from "../src/lib/acpSidebarSessions.js";
import { attachTaskListRowActivity } from "../src/v4/taskListRowActivity.js";
import { conversationTaskState } from "../src/lib/conversationTaskState.js";
import {
  boardDisplayStatus,
  boardStatusIndicator,
  isBoardItemStaged,
} from "../src/agent-board/agentBoardModel.js";
import { createAgentBoardStore } from "../src/store/agentBoardStore.js";

const native: ZCodeTaskMeta = {
  taskId: "same",
  workspacePath: "/project",
  title: "Task",
  traceId: "fixture",
  mode: "build",
  provider: "glm",
  model: "model",
  status: "completed",
  createdAt: 1,
  updatedAt: 100,
};
const acp: AcpSidebarSession = {
  id: "same",
  workspacePath: "/project",
  title: "Task",
  agent: "codex",
  status: "idle",
  createdAt: 1,
  updatedAt: 100,
};
const workTask: WorkTask = {
  id: "same",
  workspacePath: "/project",
  title: "Task",
  prompt: "Run",
  execution: {
    kind: "api",
    mode: "build",
    modelSelection: { providerId: "api", modelId: "model" },
  },
  status: "done",
  archived: false,
  runSeq: 1,
  runText: "Run",
  commandId: "cmd",
  sessionRequestId: "00000000-0000-4000-8000-000000000001",
  stopPending: false,
  createdAt: 1,
  updatedAt: 100,
};

test("all task sources use the existing board completed and failed outcomes", () => {
  for (const source of [
    { kind: "native", item: native },
    { kind: "acp", item: acp },
    { kind: "work-task", item: workTask },
  ] as const)
    assert.equal(boardDisplayStatus(conversationTaskState(source)), "completed");
  assert.equal(
    boardDisplayStatus(
      conversationTaskState({ kind: "native", item: { ...native, status: "error" } }),
    ),
    "error",
  );
  assert.equal(
    boardDisplayStatus(
      conversationTaskState({ kind: "acp", item: { ...acp, failed: true, status: "interrupted" } }),
    ),
    "error",
  );
  assert.equal(
    boardDisplayStatus(
      conversationTaskState({ kind: "work-task", item: { ...workTask, status: "failed" } }),
    ),
    "error",
  );
});

test("Host activity is authoritative and a persisted running flag is not a live run", () => {
  const persisted = { ...native, status: "running" as const };
  assert.equal(
    boardDisplayStatus(conversationTaskState({ kind: "native", item: persisted })),
    "completed",
  );
  const running = attachTaskListRowActivity(persisted, {
    phase: "running",
    lastActivityAt: 101,
    hasBackgroundWork: false,
  });
  assert.equal(
    boardDisplayStatus(conversationTaskState({ kind: "native", item: running })),
    "running",
  );
  assert.equal(
    boardStatusIndicator(
      conversationTaskState({ kind: "acp", item: { ...acp, waiting: true, status: "running" } }),
    ),
    "waiting",
  );
});

test("same IDs preserve kind, workspace identity and existing board staging keys", () => {
  const states = [
    conversationTaskState({ kind: "native", item: native }),
    conversationTaskState({ kind: "acp", item: acp }),
    conversationTaskState({ kind: "work-task", item: workTask }),
    conversationTaskState({
      kind: "native",
      item: { ...native, workspaceIdentity: "remote:project" },
    }),
  ];
  assert.equal(new Set(states.map((state) => state.key)).size, 4);
  const store = createAgentBoardStore(null);
  store.getState().setItemStaged(states[0], true);
  assert.equal(isBoardItemStaged(states[0], store.getState().stagedItems), true);
  assert.equal(isBoardItemStaged(states[1], store.getState().stagedItems), false);
  const resumed = { ...states[0], status: "running" as const, updatedAt: 200 };
  assert.equal(isBoardItemStaged(resumed, store.getState().stagedItems), false);
  store.getState().setItemStaged(resumed, true);
  assert.equal(store.getState().stagedItems[resumed.key].updatedAt, 100);
});

test("legacy work-task category migrates to all without clearing other preferences", () => {
  const initial = createAgentBoardStore(null).getState();
  let saved = JSON.stringify({
    ...initial,
    category: "work-tasks",
    project: null,
    search: "keep",
    layoutVersion: 2,
  });
  const store = createAgentBoardStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
    removeItem: () => {},
  });
  assert.equal(store.getState().category, "all");
  assert.equal(store.getState().search, "keep");
});
