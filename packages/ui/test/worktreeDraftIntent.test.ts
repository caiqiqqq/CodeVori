import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorktreeDraftSelectionActive,
  isWorktreeAutoSendTarget,
  hasUntransferableWorktreeContext,
} from "../src/v4/composer/worktreeDraftIntent.js";

test("worktree draft mode belongs to the selected workspace and new-task generation", () => {
  const selection = { workspaceKey: "/repo", draftFocusVersion: 2 };
  assert.equal(isWorktreeDraftSelectionActive(selection, "/repo", 2, null), true);
  assert.equal(isWorktreeDraftSelectionActive(selection, "/repo", 3, null), false);
  assert.equal(isWorktreeDraftSelectionActive(selection, "/other", 2, null), false);
  assert.equal(isWorktreeDraftSelectionActive(selection, "/repo", 2, "existing-task"), false);
});

test("auto-send only runs in the exact new local worktree draft", () => {
  const request = {
    requestId: 1,
    workspacePath: "/tree/abcd/repo",
    draftFocusVersion: 1,
    text: "hello",
    agent: null,
    trigger: "button" as const,
  };
  assert.equal(isWorktreeAutoSendTarget(request, "/tree/abcd/repo", undefined, null), true);
  assert.equal(isWorktreeAutoSendTarget(request, "/repo", undefined, null), false);
  assert.equal(isWorktreeAutoSendTarget(request, "/tree/abcd/repo", "remote-id", null), false);
  assert.equal(isWorktreeAutoSendTarget(request, "/tree/abcd/repo", undefined, "task"), false);
});

test("workspace-owned attachments and context block worktree creation", () => {
  assert.equal(
    hasUntransferableWorktreeContext({ attachments: 0, contexts: 0, mentions: 0 }),
    false,
  );
  assert.equal(
    hasUntransferableWorktreeContext({ attachments: 1, contexts: 0, mentions: 0 }),
    true,
  );
  assert.equal(
    hasUntransferableWorktreeContext({ attachments: 0, contexts: 1, mentions: 0 }),
    true,
  );
  assert.equal(
    hasUntransferableWorktreeContext({ attachments: 0, contexts: 0, mentions: 1 }),
    true,
  );
});
