import assert from "node:assert/strict";
import test from "node:test";
import { getGitWorktreeStatus } from "../src/lib/gitWorktreeStatus.js";
import { getGitDirtyFileCount } from "../src/git-branch-switcher/display.js";
import type { GitPaneRepositoryState } from "../src/hooks/useGitRepository.js";

function datasets(unstaged: number, staged: number): GitPaneRepositoryState["datasets"] {
  const dataset = (id: "unstaged" | "staged" | "branch" | "last-turn", added: number) => ({
    id,
    readonly: id === "branch" || id === "last-turn",
    sections: [
      {
        id: id === "last-turn" ? ("last-turn" as const) : id,
        changes: [
          {
            path: "same-file.ts",
            kind: "modified" as const,
            section: id === "last-turn" ? ("last-turn" as const) : id,
            added,
            removed: 0,
            diff: null,
          },
        ],
      },
    ],
  });
  return {
    unstaged: dataset("unstaged", unstaged),
    staged: dataset("staged", staged),
    branch: dataset("branch", 100),
    "last-turn": dataset("last-turn", 200),
  };
}

test("worktree summary counts both staged and unstaged lines, but a shared file only once", () => {
  const data = datasets(12, 3);
  assert.deepEqual(getGitWorktreeStatus(data), {
    changeSummary: { added: 15, removed: 0 },
    reviewSourceId: "unstaged",
  });
  assert.equal(getGitDirtyFileCount(data), 1);
});

test("staged-only worktree opens the staged review instead of an empty unstaged source", () => {
  assert.deepEqual(getGitWorktreeStatus(datasets(0, 3)), {
    changeSummary: { added: 3, removed: 0 },
    reviewSourceId: "staged",
  });
});

test("branch and historical turn changes cannot make a clean worktree badge appear", () => {
  assert.deepEqual(getGitWorktreeStatus(datasets(0, 0)), {
    changeSummary: { added: 0, removed: 0 },
    reviewSourceId: null,
  });
});
