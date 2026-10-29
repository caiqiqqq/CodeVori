import test from "node:test";
import assert from "node:assert/strict";
import { createAgentBoardStore } from "../src/store/agentBoardStore.js";
import {
  boardEntityKey,
  defaultBoardTracking,
  matchesBoardTracking,
  type BoardTrackingTarget,
} from "../src/agent-board/agentBoardModel.js";

test("adding one excluded entity preserves scope rules, isolates identities and persists once", () => {
  let saved: string | null = null;
  let writes = 0;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
      writes++;
    },
    removeItem() {},
  };
  const store = createAgentBoardStore(storage);
  const target: BoardTrackingTarget = {
    key: boardEntityKey(
      { workspacePath: "/same", workspaceIdentity: "remote:1" },
      "acp",
      "same-id",
    ),
    projectKey: "remote:1",
    kind: "acp",
  };
  store.getState().setTracking({
    ...defaultBoardTracking,
    mode: "custom",
    projects: ["remote:1"],
    includedItems: ["other"],
    excludedItems: [target.key, "excluded-other"],
  });
  const before = writes;
  store.getState().includeItem(target);
  store.getState().includeItem(target);
  assert.equal(writes, before + 1, "a repeated menu action must not persist twice");
  const tracking = createAgentBoardStore(storage).getState().tracking;
  assert.deepEqual(tracking.projects, ["remote:1"]);
  assert.deepEqual(tracking.includedItems, ["other", target.key]);
  assert.deepEqual(tracking.excludedItems, ["excluded-other"]);
  assert.equal(matchesBoardTracking(target, tracking), true);
  for (const [identity, kind] of [
    ["remote:2", "acp"],
    ["remote:2", "native"],
    ["remote:2", "work-task"],
  ] as const) {
    assert.equal(
      matchesBoardTracking(
        {
          ...target,
          projectKey: identity,
          kind,
          key: boardEntityKey(
            { workspacePath: "/same", workspaceIdentity: identity },
            kind,
            "same-id",
          ),
        },
        tracking,
      ),
      false,
    );
  }
});

test("an old menu action rechecks whole-group membership without widening the selection", () => {
  const store = createAgentBoardStore(null);
  const target: BoardTrackingTarget = { key: "work", kind: "work-task", projectKey: "/project" };
  const all = store.getState().tracking;
  store.getState().includeItem(target);
  assert.equal(store.getState().tracking, all);
  store.getState().setTracking({ ...defaultBoardTracking, mode: "custom", workTasks: true });
  const group = store.getState().tracking;
  store.getState().includeItem(target);
  assert.equal(store.getState().tracking, group);
  store.getState().setTracking({ ...group, workTasks: false });
  store.getState().includeItem(target);
  assert.equal(store.getState().tracking.workTasks, false);
  assert.deepEqual(store.getState().tracking.includedItems, ["work"]);
});
