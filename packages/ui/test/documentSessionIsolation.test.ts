import assert from "node:assert/strict";
import test from "node:test";
import {
  openCodeViewerSidePane,
  stampSidePaneTabsOwnership,
  getVisibleSidePaneTabs,
  normalizeWorkspaceSidePaneState,
} from "../src/lib/workspaceSidePane.ts";

test("same document keeps separate session tabs, owner metadata and navigation intents", () => {
  const source = {
    type: "pdf" as const,
    path: "/project/report.pdf",
    title: "report",
    workspacePath: "/project",
  };
  const open = (pane: any, ownerTaskId: string) =>
    stampSidePaneTabsOwnership(openCodeViewerSidePane(pane, source, ownerTaskId), {
      ownerTaskId,
      workspaceKey: "/project",
    })!;
  let pane = open(null, "a");
  const aId = pane.activeTabId;
  pane = open(pane, "b");
  assert.equal(pane.tabs.length, 2);
  assert.notEqual(pane.activeTabId, aId);
  for (const ownerTaskId of ["a", "b"])
    assert.equal(
      getVisibleSidePaneTabs(pane.tabs, { ownerTaskId, workspaceKey: "/project" }).length,
      1,
    );
  pane = open(pane, "a");
  assert.equal(pane.tabs.length, 2);
  assert.equal(pane.activeTabId, aId);
  const legacy = {
    ...pane,
    tabs: pane.tabs.map((tab) => ({ ...tab, id: `old:${tab.ownerTaskId}` })),
    activeTabId: "old:a",
  };
  const migrated = normalizeWorkspaceSidePaneState(legacy)!;
  assert.equal(migrated.activeTabId, aId);
  assert.deepEqual(normalizeWorkspaceSidePaneState(migrated), migrated);
  const remote = openCodeViewerSidePane(
    pane,
    { ...source, workspaceIdentity: "remote:fixture" },
    "a",
  );
  assert.equal(remote.tabs.length, 3);
});
