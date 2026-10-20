import assert from "node:assert/strict";
import test from "node:test";
import { resolveSidebarConversationSelection } from "../src/lib/sidebarConversationSelection.js";
import {
  INITIAL_PANE_LAYOUT,
  V4_PRIMARY_PANE_ID,
  splitPaneAtSide,
  closePane,
  focusPane,
} from "../src/v4/paneLayoutTree.js";
import { useWorkbenchGroupStore, closeWorkbenchGroupPane } from "../src/v4/workbenchGroupStore.js";

const primary = { workspacePath: "/fixture/a", activeTaskId: "native-a", activeAcpSessionId: null };
const scope = {
  workspacePath: "/fixture/shared",
  workspaceIdentity: " remote:b ",
  remoteSessionId: "attachment-b",
};
const acp = {
  workspaceScope: scope,
  sessionId: "same-id",
  kind: "acp" as const,
  agent: "codex" as const,
};
const native = {
  workspaceScope: { ...scope, workspaceIdentity: "remote:c" },
  sessionId: "same-id",
};
const expectedAcp = { ...scope, activeTaskId: null, activeAcpSessionId: "same-id" };

test("ordinary main conversation falls back to Shell and ACP never leaks into native IDs", () => {
  assert.equal(resolveSidebarConversationSelection(primary, null, INITIAL_PANE_LAYOUT), primary);
  const shellAcp = { ...primary, activeTaskId: null, activeAcpSessionId: "acp-a" };
  assert.equal(resolveSidebarConversationSelection(shellAcp, null, INITIAL_PANE_LAYOUT), shellAcp);
});

test("work tasks suppress main, temporary and grouped selection without mutating bindings", () => {
  const shellAcp = { ...primary, activeTaskId: null, activeAcpSessionId: "acp-a" };
  const temporary = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", acp);
  const store = useWorkbenchGroupStore.getState();
  store.resetWorkbenchGroups();
  try {
    store.promotePaneLayoutToGroup(
      { workspaceScope: primary, sessionId: primary.activeTaskId },
      temporary,
    );
    const state = useWorkbenchGroupStore.getState();
    const group = state.groups[state.activeGroupId!];
    for (const [shell, activeGroup, layout] of [
      [primary, null, INITIAL_PANE_LAYOUT],
      [shellAcp, null, INITIAL_PANE_LAYOUT],
      [primary, null, temporary],
      [primary, group, INITIAL_PANE_LAYOUT],
    ] as const) {
      const before = structuredClone({ shell, activeGroup, layout });
      const chatSelection = resolveSidebarConversationSelection(shell, activeGroup, layout);
      assert.deepEqual(resolveSidebarConversationSelection(shell, activeGroup, layout, false), {
        ...shell,
        activeTaskId: null,
        activeAcpSessionId: null,
      });
      assert.deepEqual({ shell, activeGroup, layout }, before);
      assert.deepEqual(
        resolveSidebarConversationSelection(shell, activeGroup, layout, true),
        chatSelection,
        "Returning to chat restores the existing typed, identity-scoped selection",
      );
    }
  } finally {
    store.resetWorkbenchGroups();
  }
});

test("temporary focus follows typed cross-project bindings and survives closing the main pane", () => {
  const two = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", acp);
  const three = splitPaneAtSide(two, "pane-1", "down", native);
  assert.deepEqual(
    resolveSidebarConversationSelection(primary, null, focusPane(three, "pane-1")),
    expectedAcp,
  );
  assert.deepEqual(resolveSidebarConversationSelection(primary, null, three), {
    ...native.workspaceScope,
    activeTaskId: "same-id",
    activeAcpSessionId: null,
  });
  const single = closePane(closePane(three, V4_PRIMARY_PANE_ID), "pane-2");
  assert.deepEqual(resolveSidebarConversationSelection(primary, null, single), expectedAcp);
  assert.deepEqual(
    resolveSidebarConversationSelection(primary, null, {
      ...single,
      focusedPaneId: V4_PRIMARY_PANE_ID,
    }),
    expectedAcp,
  );
});

test("active groups override stale temporary layout and keep the sole surviving secondary", () => {
  const store = useWorkbenchGroupStore.getState();
  store.resetWorkbenchGroups();
  try {
    const layout = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", acp);
    store.promotePaneLayoutToGroup(
      { workspaceScope: primary, sessionId: primary.activeTaskId },
      layout,
    );
    const state = useWorkbenchGroupStore.getState();
    const group = state.groups[state.activeGroupId!];
    assert.deepEqual(
      resolveSidebarConversationSelection(primary, group, INITIAL_PANE_LAYOUT),
      expectedAcp,
    );
    const single = closeWorkbenchGroupPane(group, V4_PRIMARY_PANE_ID)!;
    assert.deepEqual(
      resolveSidebarConversationSelection(primary, single, INITIAL_PANE_LAYOUT),
      expectedAcp,
    );
    assert.deepEqual(
      resolveSidebarConversationSelection(
        primary,
        { ...group, focusedPaneId: V4_PRIMARY_PANE_ID },
        layout,
      ),
      primary,
    );
  } finally {
    store.resetWorkbenchGroups();
  }
});

test("draft, readonly and unvalidated panes clear selection without borrowing old main IDs", () => {
  for (const binding of [
    { ...acp, sessionId: null },
    { ...acp, readOnly: true },
    { ...acp, restoredUnvalidated: true },
  ]) {
    const layout = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", binding);
    assert.deepEqual(resolveSidebarConversationSelection(primary, null, layout), {
      ...primary,
      activeTaskId: null,
      activeAcpSessionId: null,
    });
  }
});

test("main draft must not duplicate a Shell navigation session already owned by secondary", () => {
  const shell = { ...scope, activeTaskId: null, activeAcpSessionId: "same-id" };
  const layout = focusPane(
    splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", acp),
    V4_PRIMARY_PANE_ID,
  );
  assert.equal(resolveSidebarConversationSelection(shell, null, layout).activeAcpSessionId, null);
  assert.equal(
    resolveSidebarConversationSelection(
      { ...shell, workspaceIdentity: "remote:another" },
      null,
      layout,
    ).activeAcpSessionId,
    "same-id",
  );
  assert.equal(
    resolveSidebarConversationSelection(
      { ...shell, activeTaskId: "same-id", activeAcpSessionId: null },
      null,
      layout,
    ).activeTaskId,
    "same-id",
  );
});
