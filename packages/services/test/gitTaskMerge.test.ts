import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  createGitCommandProvider,
  type GitCommandExecutionOptions,
} from "../src/git/providers/gitCommandProvider.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createGitTaskMergeRepo } from "../src/git/repo/gitTaskMergeRepo.js";

const execute = promisify(execFile);

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "zcode-task-merge-"));
  const git = async (args: string[], cwd = project) =>
    (await execute("git", ["-C", cwd, ...args])).stdout.trim();
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "Merge Test"]);
  await git(["config", "user.email", "merge@example.invalid"]);
  await writeFile(join(project, "file.txt"), "base\n");
  await git(["add", "."]);
  await git(["commit", "-qm", "Base"]);
  await git(["branch", "release"]);
  const sourcePath = join(project, "trees", "task");
  await git(["worktree", "add", "-qb", "worktree/task", sourcePath]);
  const actual = createGitCommandProvider({ getConfiguredGitPath: async () => "git" });
  const hooks: {
    beforeCommand?: (input: GitCommandExecutionOptions) => Promise<void>;
    statusOutputBytes?: number;
  } = {};
  const commandProvider = {
    ...actual,
    async run(input: GitCommandExecutionOptions) {
      await hooks.beforeCommand?.(input);
      return actual.run({
        ...input,
        ...(input.args[0] === "status" &&
        !input.args.includes("--branch") &&
        hooks.statusOutputBytes !== undefined
          ? { maxOutputBytes: hooks.statusOutputBytes }
          : {}),
      });
    },
  };
  const repo = createGitCliRepo({ commandProvider });
  const merge = createGitTaskMergeRepo({ repo, commandProvider });
  const request = {
    workspacePath: project,
    taskWorktreePath: sourcePath,
    taskBranchName: "worktree/task",
    targetBranchName: "release",
    worktreePath: join(project, "trees", "merge"),
    branchName: "merge/test",
    commitMessage: "Task result",
  };
  // The test's worktrees are inside the temporary repo, never part of its staged result.
  await writeFile(join(project, ".git", "info", "exclude"), "trees/\n");
  return {
    project,
    sourcePath,
    git,
    merge,
    request,
    hooks,
    async cleanup() {
      await rm(project, { recursive: true, force: true });
    },
  };
}

test("task merge commits only task files, publishes to the selected unchecked-out branch and is idempotent", async () => {
  const f = await fixture();
  try {
    const main = await f.git(["rev-parse", "main"]);
    await writeFile(join(f.sourcePath, "task.txt"), "task result\n");
    await writeFile(join(f.project, "local.txt"), "unrelated local edit\n");
    const preparation = await f.merge.prepareTaskMerge(f.request);
    assert.deepEqual(preparation.conflicts, []);
    const input = { ...f.request, ...preparation };
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    await f.merge.applyTaskMerge({ ...input, resultCommit: commitHash });
    assert.equal(await f.git(["rev-parse", "release"]), commitHash);
    assert.equal(await f.git(["rev-parse", "main"]), main);
    assert.equal(await f.git(["branch", "--show-current"]), "main");
    assert.equal(await f.git(["show", "release:task.txt"]), "task result");
    assert.equal(await readFile(join(f.project, "local.txt"), "utf8"), "unrelated local edit\n");
    assert.equal(await f.git(["status", "--porcelain"], f.sourcePath), "");
    const next = await f.merge.prepareTaskMerge({
      ...f.request,
      branchName: "merge/retry",
      worktreePath: join(f.project, "trees", "retry"),
    });
    assert.equal(next.sourceCommit, preparation.sourceCommit);
    assert.equal(next.targetCommit, commitHash);
    assert.deepEqual(next.conflicts, []);
  } finally {
    await f.cleanup();
  }
});

for (const race of ["ref", "new-file", "locked-index"] as const) {
  test(`checked-out publication protects ${race} and releases only its own index lock`, async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.sourcePath, "task.txt"), "task result\n");
      const request = { ...f.request, targetBranchName: "main" };
      const preparation = await f.merge.prepareTaskMerge(request);
      const input = { ...request, ...preparation };
      const { commitHash } = await f.merge.finalizeTaskMerge(input);
      const index = await f.git(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
      let expected = preparation.targetCommit;
      if (race === "locked-index") await writeFile(`${index}.lock`, "third-party-lock");
      f.hooks.beforeCommand = async (command) => {
        if (
          race === "ref" &&
          command.args[0] === "update-ref" &&
          command.args.includes("refs/heads/main")
        ) {
          f.hooks.beforeCommand = undefined;
          const tree = await f.git(["rev-parse", `${expected}^{tree}`]);
          expected = await f.git([
            "commit-tree",
            tree,
            "-p",
            expected,
            "-m",
            "Concurrent ref update",
          ]);
          await f.git(["update-ref", "refs/heads/main", expected]);
        }
        if (
          race === "new-file" &&
          command.args[0] === "read-tree" &&
          !command.args.includes("--dry-run")
        ) {
          f.hooks.beforeCommand = undefined;
          await writeFile(join(f.project, "task.txt"), "third-party content\n");
        }
      };
      await assert.rejects(f.merge.applyTaskMerge({ ...input, resultCommit: commitHash }));
      assert.equal(await f.git(["rev-parse", "main"]), expected);
      assert.equal(await f.git(["branch", "--show-current"]), "main");
      assert.equal(await f.git(["diff", "--cached", "--name-only"]), "");
      if (race === "new-file")
        assert.equal(await readFile(join(f.project, "task.txt"), "utf8"), "third-party content\n");
      if (race === "locked-index")
        assert.equal(await readFile(`${index}.lock`, "utf8"), "third-party-lock");
      else await assert.rejects(lstat(`${index}.lock`), { code: "ENOENT" });
      await assert.rejects(lstat(`${index}.lock.lock`), { code: "ENOENT" });
    } finally {
      await f.cleanup();
    }
  });
}

test("a resolver cannot turn a text conflict into a binary file or leave non-default conflict markers", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.sourcePath, "file.txt"), "source\n");
    await writeFile(join(f.project, "file.txt"), "target\n");
    await f.git(["commit", "-qam", "Target"]);
    const request = { ...f.request, targetBranchName: "main" };
    const prepared = await f.merge.prepareTaskMerge(request);
    const input = { ...request, ...prepared };
    await writeFile(join(request.worktreePath, "file.txt"), "binary\0content");
    await assert.rejects(f.merge.finalizeTaskMerge(input), /work-task.merge-unsupported-conflict/);
    await writeFile(
      join(request.worktreePath, "file.txt"),
      "<<<<<<<<<< HEAD\nsource\n==========\ntarget\n>>>>>>>>>> source\n",
    );
    await assert.rejects(f.merge.finalizeTaskMerge(input), /work-task.merge-unresolved/);
    assert.equal(await f.git(["rev-parse", "main"]), prepared.targetCommit);
  } finally {
    await f.cleanup();
  }
});

test("a checked-out target fast-forwards without switching branches or leaving a dirty index", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.sourcePath, "task.txt"), "result\n");
    const request = { ...f.request, targetBranchName: "main" };
    const preparation = await f.merge.prepareTaskMerge(request);
    const input = { ...request, ...preparation };
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    await f.merge.applyTaskMerge({ ...input, resultCommit: commitHash });
    assert.equal(await f.git(["branch", "--show-current"]), "main");
    assert.equal(await f.git(["rev-parse", "HEAD"]), commitHash);
    assert.equal(await f.git(["status", "--porcelain"]), "");
    assert.equal(await readFile(join(f.project, "task.txt"), "utf8"), "result\n");
  } finally {
    await f.cleanup();
  }
});

test("dirty checked-out target is refused before committing the task", async () => {
  const f = await fixture();
  try {
    const original = await f.git(["rev-parse", "worktree/task"]);
    await writeFile(join(f.project, "file.txt"), "local edit\n");
    await writeFile(join(f.sourcePath, "task.txt"), "result\n");
    await assert.rejects(
      f.merge.prepareTaskMerge({ ...f.request, targetBranchName: "main" }),
      /work-task.merge-target-dirty/,
    );
    assert.equal(await f.git(["rev-parse", "worktree/task"]), original);
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "local edit\n");
  } finally {
    await f.cleanup();
  }
});

test("task changes larger than the status quota can still be committed and merged", async () => {
  const f = await fixture();
  try {
    f.hooks.statusOutputBytes = 32;
    await writeFile(join(f.sourcePath, "file.txt"), "changed task content\n");
    assert.ok(
      Buffer.byteLength(await f.git(["status", "--porcelain=v2", "-z"], f.sourcePath)) > 32,
    );
    const preparation = await f.merge.prepareTaskMerge(f.request);
    const input = { ...f.request, ...preparation };
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    await f.merge.applyTaskMerge({ ...input, resultCommit: commitHash });
    assert.equal(await f.git(["show", "release:file.txt"]), "changed task content");
    assert.equal(await f.git(["status", "--porcelain"], f.sourcePath), "");
  } finally {
    await f.cleanup();
  }
});

test("large dirty target status reports target-dirty without committing the source", async () => {
  const f = await fixture();
  try {
    f.hooks.statusOutputBytes = 32;
    const original = await f.git(["rev-parse", "worktree/task"]);
    await writeFile(join(f.project, "file.txt"), "unrelated target edit\n");
    await writeFile(join(f.sourcePath, "task.txt"), "task change\n");
    await assert.rejects(
      f.merge.prepareTaskMerge({ ...f.request, targetBranchName: "main" }),
      /work-task.merge-target-dirty/,
    );
    assert.equal(await f.git(["rev-parse", "worktree/task"]), original);
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "unrelated target edit\n");
  } finally {
    await f.cleanup();
  }
});

test("untracked target directories remain protected without expanding every file", async () => {
  const f = await fixture();
  try {
    f.hooks.statusOutputBytes = 32;
    const original = await f.git(["rev-parse", "worktree/task"]);
    const directory = join(f.project, "untracked");
    await mkdir(directory);
    for (let index = 0; index < 50; index++)
      await writeFile(join(directory, `file-${index}.txt`), "unrelated content\n");
    await writeFile(join(f.sourcePath, "task.txt"), "task change\n");
    await assert.rejects(
      f.merge.prepareTaskMerge({ ...f.request, targetBranchName: "main" }),
      /work-task.merge-target-dirty/,
    );
    assert.equal(await f.git(["rev-parse", "worktree/task"]), original);
    assert.equal(await readFile(join(directory, "file-49.txt"), "utf8"), "unrelated content\n");
  } finally {
    await f.cleanup();
  }
});

test("large status introduced while holding the target index lock is refused and retained", async () => {
  const f = await fixture();
  try {
    f.hooks.statusOutputBytes = 32;
    await writeFile(join(f.sourcePath, "task.txt"), "task change\n");
    const request = { ...f.request, targetBranchName: "main" };
    const preparation = await f.merge.prepareTaskMerge(request);
    const input = { ...request, ...preparation };
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    const index = await f.git(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    const projectPath = await realpath(f.project);
    let injected = false;
    f.hooks.beforeCommand = async (command) => {
      // Git 清单使用真实路径；规范化 macOS 的 /tmp 链接，确保竞态实际注入目标工作树。
      if (command.args[0] !== "status" || (await realpath(command.cwd)) !== projectPath) return;
      const locked = await lstat(`${index}.lock`).then(
        () => true,
        (error) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
      if (locked) {
        injected = true;
        await writeFile(join(f.project, "file.txt"), "concurrent local edit\n");
      }
    };
    await assert.rejects(
      f.merge.applyTaskMerge({ ...input, resultCommit: commitHash }),
      /work-task.merge-target-dirty/,
    );
    assert.equal(injected, true);
    assert.equal(await f.git(["rev-parse", "main"]), preparation.targetCommit);
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "concurrent local edit\n");
    await assert.rejects(lstat(`${index}.lock`), { code: "ENOENT" });
  } finally {
    await f.cleanup();
  }
});

test("conflicts stay isolated, resolved text is validated, and target movement never gets overwritten", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.sourcePath, "file.txt"), "source\n");
    await writeFile(join(f.project, "file.txt"), "target\n");
    await f.git(["commit", "-qam", "Target change"]);
    const request = { ...f.request, targetBranchName: "main" };
    const preparation = await f.merge.prepareTaskMerge(request);
    assert.deepEqual(preparation.conflicts, ["file.txt"]);
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "target\n");
    const input = { ...request, ...preparation };
    await assert.rejects(f.merge.finalizeTaskMerge(input), /work-task.merge-unresolved/);
    await f.git(["add", "file.txt"], request.worktreePath);
    await assert.rejects(f.merge.finalizeTaskMerge(input), /work-task.merge-unresolved/);
    await writeFile(join(request.worktreePath, "file.txt"), "source and target\n");
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    await writeFile(join(f.project, "other.txt"), "new target commit\n");
    await f.git(["add", "other.txt"]);
    await f.git(["commit", "-qm", "Concurrent change"]);
    const advanced = await f.git(["rev-parse", "main"]);
    await assert.rejects(
      f.merge.applyTaskMerge({ ...input, resultCommit: commitHash }),
      /work-task.merge-target-changed/,
    );
    assert.equal(await f.git(["rev-parse", "main"]), advanced);
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "target\n");
  } finally {
    await f.cleanup();
  }
});

test("resolved conflict commit is published only after both source and target ancestry are checked", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.sourcePath, "file.txt"), "source\n");
    await writeFile(join(f.project, "file.txt"), "target\n");
    await f.git(["commit", "-qam", "Target change"]);
    const request = { ...f.request, targetBranchName: "main" };
    const preparation = await f.merge.prepareTaskMerge(request);
    await writeFile(join(request.worktreePath, "file.txt"), "combined\n");
    const input = { ...request, ...preparation };
    const { commitHash } = await f.merge.finalizeTaskMerge(input);
    await f.merge.applyTaskMerge({ ...input, resultCommit: commitHash });
    assert.equal(await f.git(["rev-parse", "main"]), commitHash);
    assert.equal(
      await f.git(["merge-base", "--is-ancestor", preparation.sourceCommit, "main"]),
      "",
    );
    assert.equal(await readFile(join(f.project, "file.txt"), "utf8"), "combined\n");
  } finally {
    await f.cleanup();
  }
});

test("binary conflicts are retained for review without handing them to a text resolver", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.project, "binary.bin"), Buffer.from([0, 1]));
    await f.git(["add", "binary.bin"]);
    await f.git(["commit", "-qm", "Binary base"]);
    await f.git(["merge", "--ff-only", "main"], f.sourcePath);
    await writeFile(join(f.project, "binary.bin"), Buffer.from([0, 2]));
    await f.git(["commit", "-qam", "Binary target"]);
    await writeFile(join(f.sourcePath, "binary.bin"), Buffer.from([0, 3]));
    const target = await f.git(["rev-parse", "main"]);
    await assert.rejects(
      f.merge.prepareTaskMerge({ ...f.request, targetBranchName: "main" }),
      /work-task.merge-unsupported-conflict/,
    );
    assert.equal(await f.git(["rev-parse", "main"]), target);
  } finally {
    await f.cleanup();
  }
});
