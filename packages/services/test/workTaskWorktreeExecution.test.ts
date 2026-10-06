import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { uuidv7, type WorkTask, type AcpSessionChanged } from "@zcode/shared";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IGitService } from "../src/git/git.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createWorkTaskExecution } from "../src/work-task/workTaskExecution.js";
import { getConversationWorkspaceDir, getDataBaseDir, setDataBaseDir } from "../src/paths.js";

const gitCommand = promisify(execFile);

for (const selectedSource of [undefined, "unrelated", "missing"] as const) {
  test(`real Git source ${selectedSource ?? "HEAD"} is pinned on allocation and never switches the main project`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-task-git-"));
    const project = join(directory, "project");
    const worktreeRoot = join(directory, "missing", ".code", "worktrees");
    await mkdir(project);
    const workspacePath = join(project, "src");
    await mkdir(workspacePath);
    const git = (args: string[]) => gitCommand("git", ["-C", project, ...args]);
    try {
      await git(["init", "-q", "-b", "main"]);
      await git(["config", "user.name", "Task Test"]);
      await git(["config", "user.email", "task@example.invalid"]);
      await writeFile(join(project, "README.md"), "main branch\n");
      await git(["add", "README.md"]);
      await git(["commit", "-qm", "Initial"]);
      const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
      await git(["checkout", "-qb", "unrelated"]);
      await writeFile(join(project, "README.md"), "another branch\n");
      await git(["commit", "-qam", "Unrelated commit"]);
      await git(["checkout", "-q", "main"]);
      let task: WorkTask = {
        id: uuidv7(),
        workspacePath,
        title: "Feature",
        prompt: "Build",
        sourceBranch: selectedSource,
        execution: { kind: "acp", agent: "codex", config: [] },
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
      const service = createGitService({ repo: createGitCliRepo() });
      let trees = 0;
      let sessions = 0;
      let prompts = 0;
      const acp = {
        create: async () => {
          assert.ok(task.worktree, "allocation must be persisted before creating session");
          sessions++;
          return { id: "session" };
        },
        list: async () => [{ id: "session", agent: "codex", status: "idle" }],
        prompt: async () => {
          assert.equal(task.session?.id, "session", "binding must be persisted before prompt");
          prompts++;
          return { status: "idle" };
        },
        onDynamicSessionChanged: () => new Emitter<AcpSessionChanged>().event,
      } as unknown as IAcpService;
      const execution = createWorkTaskExecution({
        homeDirectory: directory,
        git: {
          ...service,
          createWorktree: async (input) => {
            assert.equal(task.worktree?.path, input.worktreePath, "allocation must precede Git");
            trees++;
            return service.createWorktree(input);
          },
        },
        settings: { get: async () => ({ worktreeRootDirectory: worktreeRoot }) } as ISettingService,
        acp,
        agent: {} as IZCodeAgentService,
        ensureWorkspaceSubscription: () => {},
      });
      const context = {
        signal: new AbortController().signal,
        update: async (patch: object) => {
          task = { ...task, ...patch };
          return true;
        },
      };
      if (selectedSource === "missing") {
        await assert.rejects(execution.execute(task, context), /work-task.branch-not-found/);
        assert.equal(task.worktree, undefined);
        assert.equal(trees, 0);
        assert.equal(sessions, 0);
        assert.equal(prompts, 0);
        assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
        return;
      }
      const expectedBase = selectedSource
        ? (await git(["rev-parse", selectedSource])).stdout.trim()
        : head;
      await execution.execute(task, context);
      assert.equal(task.worktree?.rootPath, worktreeRoot);
      assert.equal(task.worktree?.baseCommit, expectedBase);
      assert.match(task.worktree!.path, /worktrees\/[0-9a-f]{4}\/project$/);
      assert.equal(basename(task.worktree!.path), "project");
      const expectedContent = selectedSource ? "another branch\n" : "main branch\n";
      assert.equal(await readFile(join(task.worktree!.path, "README.md"), "utf8"), expectedContent);
      const first = structuredClone(task.worktree);
      await git(["checkout", "-q", selectedSource ?? "main"]);
      await writeFile(join(project, "README.md"), "source advanced\n");
      await git(["commit", "-qam", "Advance source after allocation"]);
      await git(["checkout", "-q", "main"]);
      task = { ...task, runSeq: 2, commandId: uuidv7(), runText: "Continue" };
      await execution.execute(task, context);
      assert.deepEqual(task.worktree, first);
      assert.equal(trees, 1);
      assert.equal(sessions, 1);
      assert.equal(prompts, 2);
      assert.equal(await readFile(join(task.worktree!.path, "README.md"), "utf8"), expectedContent);
      assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("default conversation workspace refuses its parent Git repo before any Git or Agent call, including stale allocations and aliases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-default-"));
  const previousDataDirectory = getDataBaseDir();
  try {
    setDataBaseDir(directory);
    const conversationWorkspace = getConversationWorkspaceDir();
    await mkdir(conversationWorkspace, { recursive: true });
    await gitCommand("git", ["-C", directory, "init", "-q", "-b", "main"]);
    assert.equal(
      (
        await gitCommand("git", ["-C", conversationWorkspace, "rev-parse", "--show-toplevel"])
      ).stdout.trim(),
      await realpath(directory),
      "the fixture must reproduce Git inheriting a parent repository",
    );
    const alias = join(directory, "conversation-alias");
    await symlink(conversationWorkspace, alias, process.platform === "win32" ? "junction" : "dir");
    for (const workspacePath of [conversationWorkspace, alias]) {
      for (const staleAllocation of [false, true]) {
        for (const kind of ["api", "acp"] as const) {
          const effects: string[] = [];
          const task: WorkTask = {
            workspacePath,
            id: uuidv7(),
            title: "Old default-directory task",
            prompt: "Build",
            execution:
              kind === "acp"
                ? { kind, agent: "claude", config: [] }
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
            ...(staleAllocation
              ? {
                  worktree: {
                    rootPath: join(directory, "trees"),
                    path: join(directory, "trees", "abcd", "home"),
                    projectPath: directory,
                    branchName: "worktree/abcd",
                    baseCommit: "abcdef",
                  },
                }
              : {}),
          };
          const execution = createWorkTaskExecution({
            git: {
              getWorkspaceRepositoryInfo: async () => {
                effects.push("git");
                throw new Error("Must not query the parent repository");
              },
              createWorktree: async () => {
                effects.push("worktree");
                throw new Error("Must not create a worktree");
              },
            } as unknown as IGitService,
            settings: {
              get: async () => {
                effects.push("settings");
                return {};
              },
            } as ISettingService,
            acp: {
              create: async () => {
                effects.push("acp");
                throw new Error("Must not connect an Agent");
              },
            } as unknown as IAcpService,
            agent: {} as IZCodeAgentService,
            createNativeConnection: () => {
              effects.push("native");
              throw new Error("Must not attach a native Agent");
            },
            ensureWorkspaceSubscription: () => {
              effects.push("subscribe");
            },
          });
          await assert.rejects(
            execution.execute(task, {
              signal: new AbortController().signal,
              update: async () => {
                effects.push("persist");
                return true;
              },
            }),
            /work-task\.project-required/,
          );
          assert.deepEqual(
            effects,
            [],
            `${kind}, staleAllocation=${staleAllocation}, alias=${workspacePath === alias}`,
          );
        }
      }
    }
  } finally {
    setDataBaseDir(previousDataDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});
