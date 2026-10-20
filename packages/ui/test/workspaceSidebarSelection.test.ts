import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartWorkspaceDraftOnExpand } from "../src/WorkspaceSidebar/workspaceSidebarSelection.js";

test("expanding the active project does not replace its selected conversation with a draft", () => {
  assert.equal(
    shouldStartWorkspaceDraftOnExpand({ isActiveWorkspace: true, hasActiveDescendant: false }),
    false,
  );
});

test("expanding a project that contains the active worktree preserves the worktree conversation", () => {
  assert.equal(
    shouldStartWorkspaceDraftOnExpand({ isActiveWorkspace: false, hasActiveDescendant: true }),
    false,
  );
});

test("opening an unrelated collapsed project still starts its new draft", () => {
  assert.equal(
    shouldStartWorkspaceDraftOnExpand({ isActiveWorkspace: false, hasActiveDescendant: false }),
    true,
  );
});
