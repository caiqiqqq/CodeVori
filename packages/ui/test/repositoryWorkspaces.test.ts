import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";
import { groupWorktreeProjectTabs } from "../src/lib/worktreeProjectGrouping.js";
import { buildWorkspaceSessionKey } from "../src/lib/remoteWorkspaceHistory.js";
import {
  getRepositoryWorkspaceOptions,
  type RepositoryWorkspaceTab,
} from "../src/lib/repositoryWorkspaces.js";

function projectOptions(
  tabs: readonly RepositoryWorkspaceTab[],
  connectedSessionIds?: ReadonlySet<string>,
  info: Record<string, GitWorkspaceRepositoryInfo> = {},
) {
  return getRepositoryWorkspaceOptions(
    groupWorktreeProjectTabs(
      tabs.map((tab) => ({ ...tab, kind: "workspace", id: buildWorkspaceSessionKey(tab) })),
      info,
    ),
    connectedSessionIds,
  );
}

test("repository projects exclude conversations and deduplicate by trimmed identity", () => {
  const tabs: RepositoryWorkspaceTab[] = [
    { workspacePath: "/project", label: "project" },
    { workspacePath: "/project", label: "duplicate" },
    { workspacePath: "/chat", label: "chat", workspacePurpose: "conversation" },
    { workspacePath: "/worktrees/abcd/project", label: "project" },
    {
      workspacePath: "/project",
      label: "remote project",
      workspaceIdentity: " remote-project ",
      remoteSessionId: "remote-1",
    },
    {
      workspacePath: "/project",
      label: "duplicate remote",
      workspaceIdentity: "remote-project",
      remoteSessionId: "remote-1",
    },
  ];
  const options = projectOptions(tabs, new Set(["remote-1"]));
  assert.deepEqual(
    options.map((option) => option.key),
    ["/project", "/worktrees/abcd/project", "remote-project"],
  );
  assert.equal(options[2]?.workspaceIdentity, " remote-project ");
  assert.ok(options.every((option) => !option.disabledReason));
});

test("remote projects with identical paths stay distinct and expose remote subtitles", () => {
  const options = projectOptions(
    [
      { workspacePath: "/project", label: "project" },
      ...["alpha", "beta"].map((host) => ({
        workspacePath: "/project",
        label: "project",
        workspaceIdentity: `remote:${host}`,
        remoteSessionId: host,
        remoteTarget: { kind: "ssh" as const, host: `${host}.example.invalid`, username: "test" },
      })),
    ],
    new Set(["alpha", "beta"]),
  );
  assert.equal(options.length, 3);
  assert.equal(options[1]?.remoteSubtitle, "SSH · test@alpha.example.invalid");
  assert.equal(options[2]?.remoteSubtitle, "SSH · test@beta.example.invalid");
});

test("unavailable directories and disconnected remote projects are visible but disabled", () => {
  const options = projectOptions([
    { workspacePath: "C:\\code\\app", label: "", availability: "unavailable-local-directory" },
    { workspacePath: "/disconnected", label: "offline", workspaceIdentity: "remote:offline" },
    {
      workspacePath: "/stale",
      label: "stale connection",
      workspaceIdentity: "remote:stale",
      remoteSessionId: "unregistered-session",
    },
  ]);
  assert.equal(options[0]?.label, "app");
  assert.deepEqual(
    options.map((option) => option.disabledReason),
    ["unavailable", "disconnected", "disconnected"],
  );
});

test("project options retain every opened project without a five-item limit", () => {
  const options = projectOptions(
    Array.from({ length: 40 }, (_, index) => ({ workspacePath: `/project-${index}`, label: "" })),
  );
  assert.equal(options.length, 40);
  assert.equal(options.at(-1)?.label, "project-39");
});

test("project picker excludes linked worktrees even when their main project is not open", () => {
  const main = { workspacePath: "/projects/app", label: "app" };
  const child = { workspacePath: "/trees/abcd/app", label: "app" };
  const orphan = { workspacePath: "/trees/ef01/app", label: "app" };
  const info: Record<string, GitWorkspaceRepositoryInfo> = {
    [main.workspacePath]: {
      workspacePath: main.workspacePath,
      kind: "main-tree",
      repoRoot: main.workspacePath,
      isGitAvailable: true,
    },
    ...Object.fromEntries(
      [child, orphan].map((tab) => [
        tab.workspacePath,
        {
          workspacePath: tab.workspacePath,
          kind: "linked-worktree",
          repoRoot: tab.workspacePath,
          mainWorktreePath: tab === child ? main.workspacePath : "/unopened/app",
          branchName: "worktree/abcd",
          isGitAvailable: true,
        },
      ]),
    ),
  };
  assert.deepEqual(
    projectOptions([child, main, orphan], undefined, info).map((option) => option.key),
    [main.workspacePath],
  );
  assert.deepEqual(projectOptions([child, orphan], undefined, info), []);
});

test("local worktree classification cannot hide an identical remote path or guess by directory names", () => {
  const child = { workspacePath: "/worktrees/abcd/app", label: "app" };
  const remote = { ...child, workspaceIdentity: "remote:app", remoteSessionId: "remote-1" };
  const normal = { workspacePath: "/worktrees/normal/app", label: "app" };
  const info: Record<string, GitWorkspaceRepositoryInfo> = {
    [child.workspacePath]: {
      workspacePath: child.workspacePath,
      kind: "linked-worktree",
      repoRoot: child.workspacePath,
      mainWorktreePath: "/unopened/app",
      isGitAvailable: true,
    },
  };
  const options = projectOptions([child, remote, normal], new Set(["remote-1"]), info);
  assert.deepEqual(
    options.map((option) => option.key),
    ["remote:app", normal.workspacePath],
  );
});
