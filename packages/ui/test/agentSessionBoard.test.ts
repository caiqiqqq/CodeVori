import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeBoardStatus,
  acpBoardStatus,
  boardEntityKey,
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
