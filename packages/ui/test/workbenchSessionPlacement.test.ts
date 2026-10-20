import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrimaryWorkbenchSessionBinding,
  placeWorkbenchSessionInSplit,
  selectWorkbenchSession,
} from "../src/v4/workbenchSessionPlacement.js";
import { usePaneLayoutStore, V4_PRIMARY_PANE_ID, leafPaneIds } from "../src/v4/paneLayoutStore.js";
import { useWorkbenchGroupStore } from "../src/v4/workbenchGroupStore.js";

const project = {
  workspacePath: "/fixture/project",
  workspaceIdentity: "remote:project",
  remoteSessionId: "attachment:project",
};
const tasks = { workspacePath: "/fixture/tasks" };
const acp = { id: "project-acp", agent: "codex" as const };

function reset() {
  useWorkbenchGroupStore.getState().resetWorkbenchGroups();
  usePaneLayoutStore.getState().resetToPrimaryPane();
}

test("primary binding reads the visible ACP identity before native draft/task selection", () => {
  const expected = { workspaceScope: project, sessionId: acp.id, kind: "acp", agent: "codex" };
  assert.deepEqual(buildPrimaryWorkbenchSessionBinding(project, null, acp), expected);
  assert.deepEqual(buildPrimaryWorkbenchSessionBinding(project, "old-native", acp), expected);
  assert.deepEqual(buildPrimaryWorkbenchSessionBinding(project, "native", null), {
    workspaceScope: project,
    sessionId: "native",
  });
  assert.equal(buildPrimaryWorkbenchSessionBinding(project, null, null), null);
});

test("cross-workspace split retains both typed bindings in every native/ACP combination", () => {
  try {
    for (const primaryAcp of [false, true])
      for (const targetAcp of [false, true]) {
        reset();
        const primary = buildPrimaryWorkbenchSessionBinding(
          project,
          primaryAcp ? null : "project-native",
          primaryAcp ? acp : null,
        );
        const target = {
          ...tasks,
          sessionId: "task",
          ...(targetAcp ? { kind: "acp" as const, agent: "claude" as const } : {}),
        };
        assert.equal(
          placeWorkbenchSessionInSplit(primary, target, { mode: "context-menu", side: "right" }),
          true,
        );
        let state = useWorkbenchGroupStore.getState();
        const group = state.groups[state.activeGroupId!];
        assert.ok(group);
        assert.deepEqual(group.primaryBinding, primary);
        assert.deepEqual(group.panes["pane-1"], {
          workspaceScope: tasks,
          sessionId: "task",
          ...(targetAcp ? { kind: "acp", agent: "claude" } : {}),
        });
        assert.deepEqual(leafPaneIds(group.root), [V4_PRIMARY_PANE_ID, "pane-1"]);
        state.focusPane(group.id, V4_PRIMARY_PANE_ID);
        assert.equal(selectWorkbenchSession(null, target), true);
        state = useWorkbenchGroupStore.getState();
        assert.equal(state.groups[group.id]?.focusedPaneId, "pane-1");
        assert.deepEqual(state.groups[group.id]?.primaryBinding, primary);
      }
  } finally {
    reset();
  }
});

test("clicking a grouped ACP conversation focuses its original pane without starting a draft", () => {
  reset();
  try {
    const primary = buildPrimaryWorkbenchSessionBinding(project, null, acp);
    placeWorkbenchSessionInSplit(
      primary,
      { ...tasks, sessionId: "native" },
      { mode: "context-menu", side: "right" },
    );
    const before = useWorkbenchGroupStore.getState();
    assert.equal(
      selectWorkbenchSession(
        { workspaceScope: tasks, sessionId: "native" },
        { ...project, sessionId: acp.id, kind: "acp", agent: acp.agent },
      ),
      true,
    );
    const after = useWorkbenchGroupStore.getState();
    assert.equal(after.activeGroupId, before.activeGroupId);
    assert.equal(Object.keys(after.groups).length, 1);
    assert.equal(after.groups[after.activeGroupId!]?.focusedPaneId, V4_PRIMARY_PANE_ID);
    assert.deepEqual(after.groups[after.activeGroupId!]?.primaryBinding, primary);
    assert.deepEqual(
      after.groups[after.activeGroupId!]?.panes,
      before.groups[before.activeGroupId!]?.panes,
    );
  } finally {
    reset();
  }
});

test("ACP selection replaces only the focused temporary secondary and reports that owner", () => {
  reset();
  try {
    const panes = usePaneLayoutStore.getState();
    panes.splitPaneWithBinding(V4_PRIMARY_PANE_ID, "right", {
      workspaceScope: tasks,
      sessionId: "native",
    });
    let clearSelectionCalls = 0;
    assert.equal(
      selectWorkbenchSession(
        { workspaceScope: tasks, sessionId: "native" },
        { ...project, sessionId: acp.id, kind: "acp", agent: acp.agent },
        () => {
          clearSelectionCalls++;
          assert.equal(usePaneLayoutStore.getState().panes["pane-1"]?.sessionId, "native");
        },
      ),
      true,
    );
    assert.equal(clearSelectionCalls, 1);
    assert.deepEqual(usePaneLayoutStore.getState().panes["pane-1"], {
      workspaceScope: project,
      sessionId: acp.id,
      kind: "acp",
      agent: "codex",
    });
    assert.equal(useWorkbenchGroupStore.getState().activeGroupId, null);
    assert.deepEqual(leafPaneIds(usePaneLayoutStore.getState().root), [
      V4_PRIMARY_PANE_ID,
      "pane-1",
    ]);
  } finally {
    reset();
  }
});

test("grouped and unplaced selections do not clear the native shell projection", () => {
  reset();
  try {
    const target = { ...project, sessionId: acp.id, kind: "acp" as const, agent: acp.agent };
    const unexpectedClear = () =>
      assert.fail("Only temporary secondary selection can clear navigation");
    assert.equal(selectWorkbenchSession(null, target, unexpectedClear), false);
    const primary = buildPrimaryWorkbenchSessionBinding(project, null, acp);
    placeWorkbenchSessionInSplit(
      primary,
      { ...tasks, sessionId: "native" },
      { mode: "context-menu", side: "right" },
    );
    assert.equal(selectWorkbenchSession(null, target, unexpectedClear), true);
  } finally {
    reset();
  }
});

test("ordinary unplaced history keeps primary navigation and same IDs retain kind/identity isolation", () => {
  reset();
  try {
    const target = { ...project, sessionId: acp.id, kind: "acp" as const, agent: acp.agent };
    assert.equal(selectWorkbenchSession(null, target), false);
    const primary = buildPrimaryWorkbenchSessionBinding(project, "same-id", null);
    placeWorkbenchSessionInSplit(
      primary,
      { ...project, sessionId: "same-id", kind: "acp", agent: "codex" },
      { mode: "context-menu", side: "right" },
    );
    placeWorkbenchSessionInSplit(
      primary,
      {
        ...project,
        workspaceIdentity: "remote:another",
        remoteSessionId: "attachment:another",
        sessionId: "same-id",
        kind: "acp",
        agent: "codex",
      },
      { mode: "context-menu", side: "right" },
    );
    assert.equal(Object.keys(useWorkbenchGroupStore.getState().sessionIndex).length, 3);
  } finally {
    reset();
  }
});
