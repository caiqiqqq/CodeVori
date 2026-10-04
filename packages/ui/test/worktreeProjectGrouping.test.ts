import assert from "node:assert/strict";
import test from "node:test";
import { groupWorktreeProjectTabs } from "../src/lib/worktreeProjectGrouping.js";
import type { WorkspaceTabState } from "../src/store/tabStore.js";
import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";

function tab(id: string, workspacePath: string, workspaceIdentity?: string): WorkspaceTabState {
  return { id, kind: "workspace", label: "topology", workspacePath, workspaceIdentity };
}

const main = tab("main", "/projects/topology");
const first = tab("first", "/worktrees/fc90/topology");
const second = tab("second", "/worktrees/ab21/topology");

const info: Record<string, GitWorkspaceRepositoryInfo> = {
  [main.workspacePath]: {
    workspacePath: main.workspacePath,
    kind: "main-tree",
    isGitAvailable: true,
    repoRoot: main.workspacePath,
  },
  [first.workspacePath]: {
    workspacePath: first.workspacePath,
    kind: "linked-worktree",
    isGitAvailable: true,
    repoRoot: first.workspacePath,
    mainWorktreePath: main.workspacePath,
    branchName: "worktree/fc90",
  },
  [second.workspacePath]: {
    workspacePath: second.workspacePath,
    kind: "linked-worktree",
    isGitAvailable: true,
    repoRoot: second.workspacePath,
    mainWorktreePath: main.workspacePath,
    branchName: "worktree/ab21",
  },
};

test("opened linked worktrees appear under their Git main project, regardless of tab order", () => {
  const groups = groupWorktreeProjectTabs([first, main, second], info);
  assert.deepEqual(
    groups.map((group) => group.tab.id),
    ["main"],
  );
  assert.deepEqual(
    groups[0]?.worktrees.map((child) => child.tab.id),
    ["first", "second"],
  );
  assert.deepEqual(
    groups[0]?.worktrees.map((child) => child.branchName),
    ["worktree/fc90", "worktree/ab21"],
  );
  assert.equal(groups[0]?.isLinkedWorktree, false);
  assert.deepEqual(
    groups[0]?.workspaceTabs.map((scope) => scope.id),
    ["main", "first", "second"],
  );
});

test("missing main project, unrelated same-name repo and remote tab remain separate", () => {
  const unrelated = tab("unrelated", "/elsewhere/topology");
  const remote = tab("remote", "/projects/topology", "ssh:other-host:/projects/topology");
  assert.deepEqual(
    groupWorktreeProjectTabs([first, unrelated, remote], info).map((group) => group.tab.id),
    ["first", "unrelated", "remote"],
  );
  assert.deepEqual(
    groupWorktreeProjectTabs([main, first], {}).map((group) => group.tab.id),
    ["main", "first"],
  );
  const groups = groupWorktreeProjectTabs([first, unrelated, remote], info);
  assert.deepEqual(
    groups.map((group) => group.isLinkedWorktree),
    [true, false, false],
  );
  assert.deepEqual(groups[0]?.workspaceTabs, [first]);
});

test("local worktree conversation scopes never absorb a remote workspace with the same path", () => {
  const remote = tab(
    "remote-worktree",
    first.workspacePath,
    "ssh:other-host:/worktrees/fc90/topology",
  );
  const groups = groupWorktreeProjectTabs([main, first, remote], info);
  const group = groups[0];
  assert.deepEqual(group?.workspaceTabs, [main, first]);
  assert.equal(group?.workspaceTabs[1]?.workspacePath, first.workspacePath);
  assert.equal(group?.workspaceTabs[1]?.workspaceIdentity, undefined);
  assert.equal(group?.workspaceTabs[1]?.id, first.id);
  assert.equal(groups[1]?.isLinkedWorktree, false);
  assert.deepEqual(groups[1]?.workspaceTabs, [remote]);
});
