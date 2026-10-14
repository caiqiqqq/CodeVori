import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationStatusBranchLabel } from "../src/v4/conversationStatusPanelBranch.js";

const labels = {
  loadingLabel: "loading",
  unavailableLabel: "unavailable",
  notRepositoryLabel: "not-repository",
  detachedLabel: "detached",
  unknownLabel: "unknown",
};

const summary = {
  workspacePath: "/workspace",
  repoRoot: "/workspace",
  workspaceInRepoPath: ".",
  autoRefreshWatchPaths: [],
  branchName: "feature/144",
  trackingBranchName: null,
  headRefType: "branch" as const,
  ahead: 0,
  behind: 0,
  isDirty: false,
  isGitAvailable: true,
  isRepository: true,
};

test("Git branch status stays loading while the target workspace is being read", () => {
  assert.equal(
    resolveConversationStatusBranchLabel({ ...labels, gitSummary: summary, gitLoading: true }),
    "loading",
  );
  assert.equal(
    resolveConversationStatusBranchLabel({ ...labels, gitSummary: summary, gitLoading: false }),
    "feature/144",
  );
});

test("confirmed Git unavailable and non-repository states remain visible", () => {
  assert.equal(
    resolveConversationStatusBranchLabel({
      ...labels,
      gitSummary: { ...summary, isGitAvailable: false, isRepository: false },
    }),
    "unavailable",
  );
  assert.equal(
    resolveConversationStatusBranchLabel({
      ...labels,
      gitSummary: { ...summary, isRepository: false },
    }),
    "not-repository",
  );
});
