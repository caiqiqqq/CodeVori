import assert from "node:assert/strict";
import test from "node:test";
import { createTabStore } from "../src/store/tabStore.ts";
import {
  consumeWorktreeSettingsConversation,
  listenWorktreeSettingsConversation,
  requestWorktreeSettingsConversation,
} from "../src/lib/worktreeSettingsNavigation.ts";

test("a local worktree wins path-only navigation over a remote tab with the same path", () => {
  const tabs = createTabStore(null);
  const path = "/tmp/worktrees/abcd/project";
  tabs.getState().addTab(path, {
    workspaceIdentity: "ssh:other-host:/tmp/worktrees/abcd/project",
    remoteSessionId: "remote-session",
  });
  const local = tabs.getState().addTab(path);
  tabs.getState().activateTabByPath(path);
  assert.equal(tabs.getState().activeTabId, local);
  assert.equal(tabs.getState().activeWorkspaceIdentity, null);
});

test("settings navigation intent replays to a newly mounted shell once", () => {
  const target = {
    kind: "api" as const,
    workspacePath: "/tmp/worktrees/abcd/project",
    taskId: "saved",
  };
  requestWorktreeSettingsConversation(target);
  const observed: string[] = [];
  const unsubscribe = listenWorktreeSettingsConversation((item) => {
    if (item.kind === "api") observed.push(item.taskId);
    consumeWorktreeSettingsConversation(item);
  });
  unsubscribe();
  const unsubscribeAgain = listenWorktreeSettingsConversation((item) => {
    if (item.kind === "api") observed.push(item.taskId);
  });
  unsubscribeAgain();
  assert.deepEqual(observed, ["saved"]);
});
