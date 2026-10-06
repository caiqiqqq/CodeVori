import assert from "node:assert/strict";
import test from "node:test";
import {
  closePane,
  effectiveFocusedPaneId,
  focusPane,
  INITIAL_PANE_LAYOUT,
  leafPaneIds,
  splitPaneAtSide,
  V4_PRIMARY_PANE_ID,
} from "../src/v4/paneLayoutTree.js";
import { persistPaneLayout, readPersistedPaneLayout } from "../src/v4/paneLayoutPersistence.js";
import {
  closeWorkbenchGroupPane,
  selectWorkbenchGroupActiveBinding,
  useWorkbenchGroupStore,
} from "../src/v4/workbenchGroupStore.js";

const scope = {
  workspacePath: "/fixture/project",
  workspaceIdentity: "remote:fixture",
  remoteSessionId: "attachment:fixture",
};
const primary = { workspaceScope: scope, sessionId: "primary" };
const native = { workspaceScope: scope, sessionId: "shared-id" };
const acp = {
  workspaceScope: scope,
  sessionId: "shared-id",
  kind: "acp" as const,
  agent: "codex" as const,
};
function threePaneLayout() {
  const two = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", native);
  return splitPaneAtSide(two, "pane-1", "down", acp);
}

test("closing the main draft preserves typed bindings, pane IDs and surviving focus", () => {
  const layout = threePaneLayout();
  const closed = closePane(layout, V4_PRIMARY_PANE_ID);
  assert.deepEqual(leafPaneIds(closed.root), ["pane-1", "pane-2"]);
  assert.equal(closed.panes["pane-1"], layout.panes["pane-1"]);
  assert.equal(closed.panes["pane-2"], layout.panes["pane-2"]);
  assert.equal(closed.focusedPaneId, "pane-2");
  assert.equal(closePane(closed, V4_PRIMARY_PANE_ID), closed);
  assert.equal(closePane(closed, "missing"), closed);

  const focusedMain = focusPane(layout, V4_PRIMARY_PANE_ID);
  assert.equal(closePane(focusedMain, V4_PRIMARY_PANE_ID).focusedPaneId, "pane-1");
  assert.equal(closePane(layout, "pane-2").focusedPaneId, V4_PRIMARY_PANE_ID);
});

test("last-pane protection does not prevent clearing a removed session", () => {
  const closed = closePane(threePaneLayout(), V4_PRIMARY_PANE_ID);
  const single = closePane(closed, "pane-1");
  assert.deepEqual(single.root, { type: "leaf", paneId: "pane-2" });
  assert.equal(single.focusedPaneId, "pane-2");
  assert.equal(closePane(single, "pane-2"), single);
  assert.equal(closePane(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID), INITIAL_PANE_LAYOUT);
  assert.equal(closePane(single, "pane-2", "session-removed"), INITIAL_PANE_LAYOUT);
  assert.equal(effectiveFocusedPaneId({ ...single, focusedPaneId: "missing" }), "pane-2");
});

test("a layout without the main pane persists and restores actual leaf focus and ACP scope", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const layout = closePane(threePaneLayout(), V4_PRIMARY_PANE_ID);
    persistPaneLayout({ ...layout, focusedPaneId: "missing" });
    const restored = readPersistedPaneLayout();
    assert.ok(restored);
    assert.deepEqual(leafPaneIds(restored.root), ["pane-1", "pane-2"]);
    assert.equal(restored.focusedPaneId, "pane-1");
    assert.deepEqual(restored.panes["pane-2"], { ...acp, restoredUnvalidated: true });
    persistPaneLayout(closePane(layout, "pane-1"));
    assert.deepEqual(readPersistedPaneLayout()?.root, { type: "leaf", paneId: "pane-2" });
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("groups retain surviving panes including a sole ACP binding without a main pane", () => {
  const store = useWorkbenchGroupStore.getState();
  store.resetWorkbenchGroups();
  store.promotePaneLayoutToGroup(primary, threePaneLayout());
  const group = Object.values(useWorkbenchGroupStore.getState().groups)[0];
  store.resetWorkbenchGroups();
  assert.ok(group);
  const closed = closeWorkbenchGroupPane(group, V4_PRIMARY_PANE_ID);
  assert.ok(closed);
  assert.equal(closed.primaryBinding, null);
  assert.deepEqual(leafPaneIds(closed.root), ["pane-1", "pane-2"]);
  assert.equal(selectWorkbenchGroupActiveBinding(closed)?.kind, "acp");
  const single = closeWorkbenchGroupPane(closed, "pane-1");
  assert.ok(single);
  assert.deepEqual(leafPaneIds(single.root), ["pane-2"]);
  assert.equal(selectWorkbenchGroupActiveBinding(single)?.kind, "acp");
  assert.equal(closeWorkbenchGroupPane(single, "pane-2"), single);
  assert.equal(closeWorkbenchGroupPane(single, "missing", "session-removed"), single);
  assert.equal(closeWorkbenchGroupPane(single, "pane-2", "session-removed"), null);
});

test("group index removes only the closed binding and accepts promotion without a main pane", () => {
  const store = useWorkbenchGroupStore.getState();
  store.resetWorkbenchGroups();
  assert.equal(store.promotePaneLayoutToGroup(primary, threePaneLayout()), true);
  let state = useWorkbenchGroupStore.getState();
  assert.ok(state.activeGroupId);
  store.closePane(state.activeGroupId, V4_PRIMARY_PANE_ID);
  state = useWorkbenchGroupStore.getState();
  assert.deepEqual(Object.keys(state.sessionIndex).sort(), [
    "remote:fixture::acp::shared-id",
    "remote:fixture::shared-id",
  ]);
  assert.ok(state.activeGroupId);
  store.closePane(state.activeGroupId, "pane-1");
  state = useWorkbenchGroupStore.getState();
  assert.deepEqual(Object.keys(state.sessionIndex), ["remote:fixture::acp::shared-id"]);
  store.resetWorkbenchGroups();
  assert.equal(
    store.promotePaneLayoutToGroup(null, closePane(threePaneLayout(), V4_PRIMARY_PANE_ID)),
    true,
  );
  state = useWorkbenchGroupStore.getState();
  assert.equal(state.groups[state.activeGroupId!]?.primaryBinding, null);
  store.resetWorkbenchGroups();
});
