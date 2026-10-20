import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { uuidv7, type WorkTask } from "@zcode/shared";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IGitService } from "../src/git/git.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createWorkTaskExecution } from "../src/work-task/workTaskExecution.js";

const gitCommand = promisify(execFile);

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-home-repo-"));
  const homeDirectory = join(directory, "home");
  const workspacePath = join(homeDirectory, "project");
  const homeAlias = join(directory, "home-alias");
  const workspaceAlias = join(directory, "project-alias");
  try {
    await mkdir(workspacePath, { recursive: true });
    await gitCommand("git", ["-C", homeDirectory, "init", "-q", "-b", "main"]);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(homeDirectory, homeAlias, linkType);
    await symlink(workspacePath, workspaceAlias, linkType);
    return {
      directory,
      homeDirectory,
      homeAlias,
      workspacePath,
      workspaceAlias,
      git: createGitService({ repo: createGitCliRepo() }),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function task(workspacePath: string, kind: "api" | "acp"): WorkTask {
  return {
    workspacePath,
    id: uuidv7(),
    title: "Project boundary test",
    prompt: "Build",
    execution:
      kind === "acp"
        ? { kind, agent: "codex", config: [] }
        : { kind, modelSelection: { providerId: "api", modelId: "test" }, mode: "build" },
    status: "preparing",
    archived: false,
    stopPending: false,
    runSeq: 1,
    runText: "Build",
    commandId: uuidv7(),
    sessionRequestId: uuidv7(),
    createdAt: 1,
    updatedAt: 1,
  };
}

async function assertRefused(
  f: Awaited<ReturnType<typeof fixture>>,
  input: WorkTask,
  discoverRepository: boolean,
) {
  const before = structuredClone(input);
  const effects: string[] = [];
  const unexpected = (effect: string): never => {
    effects.push(effect);
    throw new Error(`Unexpected ${effect}`);
  };
  const execution = createWorkTaskExecution({
    homeDirectory: f.homeAlias,
    git: {
      getWorkspaceRepositoryInfo: async (request) => {
        effects.push("repository-info");
        return f.git.getWorkspaceRepositoryInfo(request);
      },
      getCommitGraph: async () => unexpected("commit-graph"),
      createWorktree: async () => unexpected("worktree"),
      listManagedWorktrees: async () => unexpected("managed-worktrees"),
    } as unknown as IGitService,
    settings: { get: async () => unexpected("settings") } as unknown as ISettingService,
    acp: {
      create: async () => unexpected("acp-create"),
      list: async () => unexpected("acp-list"),
      prompt: async () => unexpected("acp-prompt"),
    } as unknown as IAcpService,
    agent: {} as IZCodeAgentService,
    createNativeConnection: () => unexpected("native-connection"),
    ensureWorkspaceSubscription: () => unexpected("subscribe"),
  });
  await assert.rejects(
    execution.execute(input, {
      signal: new AbortController().signal,
      update: async () => unexpected("persist"),
    }),
    /work-task\.home-repository/,
  );
  assert.deepEqual(effects, discoverRepository ? ["repository-info"] : []);
  assert.deepEqual(input, before, "rejection must preserve existing allocation and binding");
}

test("API and ACP refuse the home directory and its alias before querying Git", async () => {
  const f = await fixture();
  try {
    for (const workspacePath of [f.homeDirectory, f.homeAlias]) {
      for (const kind of ["api", "acp"] as const) {
        await assertRefused(f, task(workspacePath, kind), false);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("API and ACP refuse a project inheriting the home repository after lightweight discovery", async () => {
  const f = await fixture();
  try {
    for (const workspacePath of [f.workspacePath, f.workspaceAlias]) {
      const info = await f.git.getWorkspaceRepositoryInfo({ workspacePath });
      assert.equal(info.repoRoot, await realpath(f.homeDirectory));
      for (const kind of ["api", "acp"] as const) {
        await assertRefused(f, task(workspacePath, kind), true);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("a linked worktree of the home repository is refused using its main project root", async () => {
  const f = await fixture();
  const workspacePath = join(f.directory, "linked-worktree");
  try {
    await gitCommand("git", [
      "-C",
      f.homeDirectory,
      "-c",
      "user.name=Task Test",
      "-c",
      "user.email=task@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "Initial",
    ]);
    await gitCommand("git", [
      "-C",
      f.homeDirectory,
      "worktree",
      "add",
      "-qb",
      "worktree/test",
      workspacePath,
    ]);
    const info = await f.git.getWorkspaceRepositoryInfo({ workspacePath });
    assert.equal(info.kind, "linked-worktree");
    assert.equal(info.mainWorktreePath, await realpath(f.homeDirectory));
    for (const kind of ["api", "acp"] as const) {
      await assertRefused(f, task(workspacePath, kind), true);
    }
  } finally {
    await f.cleanup();
  }
});

test("stale home allocations cannot bypass the boundary on retry, even with an existing tree and session", async () => {
  const f = await fixture();
  try {
    await gitCommand("git", ["-C", f.workspacePath, "init", "-q", "-b", "main"]);
    for (const projectPath of [f.homeDirectory, f.homeAlias]) {
      for (const existing of [false, true]) {
        const path = join(f.directory, existing ? "existing" : "missing", "abcd", "home");
        if (existing) await mkdir(path, { recursive: true });
        for (const kind of ["api", "acp"] as const) {
          const input = task(f.workspacePath, kind);
          input.runSeq = 2;
          input.worktree = {
            projectPath,
            rootPath: join(f.directory, "trees"),
            path,
            branchName: "worktree/abcd",
            baseCommit: "abcdef",
          };
          if (existing) input.session = { kind, id: "previous-session" };
          await assertRefused(f, input, false);
        }
      }
    }
  } finally {
    await f.cleanup();
  }
});
