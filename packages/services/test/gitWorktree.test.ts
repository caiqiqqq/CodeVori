import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";

const execFileAsync = promisify(execFile);

async function createGitRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zcode-git-worktree-"));
  await execFileAsync("git", ["init", "-q", root]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "ZCode Test"]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "zcode@example.invalid"]);
  await writeFile(join(root, "README.md"), "initial\n");
  await execFileAsync("git", ["-C", root, "add", "README.md"]);
  await execFileAsync("git", ["-C", root, "commit", "-qm", "initial"]);
  return root;
}

test("GitCliRepo creates a linked worktree without changing the current workspace", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-git-worktree-target-"));
  const worktreePath = join(container, "target");
  const repo = createGitCliRepo();

  try {
    const currentBranch = await execFileAsync("git", ["-C", root, "branch", "--show-current"]);
    const result = await repo.createWorktree(root, "feature/worktree", worktreePath);

    assert.equal(result.ok, true);
    assert.equal(result.branchName, "feature/worktree");
    assert.equal(result.worktreePath, worktreePath);
    await stat(join(worktreePath, "README.md"));

    const branch = await execFileAsync("git", ["-C", root, "branch", "--show-current"]);
    assert.equal(branch.stdout.trim(), currentBranch.stdout.trim());
    const worktreeBranch = await execFileAsync("git", [
      "-C",
      worktreePath,
      "branch",
      "--show-current",
    ]);
    assert.equal(worktreeBranch.stdout.trim(), "feature/worktree");
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("GitCliRepo rejects an invalid branch name before creating a worktree", async () => {
  const root = await createGitRepository();
  const repo = createGitCliRepo();
  try {
    const result = await repo.createWorktree(root, "invalid name", join(root, "../invalid-target"));
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.code, "invalid-branch-name");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitCliRepo reports a non-empty target directory", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-git-worktree-non-empty-"));
  const target = join(container, "target");
  await mkdir(target);
  await writeFile(join(target, "keep.txt"), "keep\n");
  const repo = createGitCliRepo();

  try {
    const result = await repo.createWorktree(root, "feature/non-empty", target);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.code, "target-path-not-empty");
    assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("GitCliRepo creates an automatic worktree under id/repository from a nested workspace", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-auto-worktree-"));
  const worktreeRoot = join(container, "nested", "worktrees");
  const repo = createGitCliRepo({ generateWorktreeId: () => "ec86" });

  try {
    await mkdir(join(root, "src"));
    const currentBranch = await execFileAsync("git", ["-C", root, "branch", "--show-current"]);
    const result = await repo.createAutomaticWorktree(join(root, "src"), worktreeRoot);
    const target = join(worktreeRoot, "ec86", basename(root));

    assert.equal(result.ok, true);
    assert.equal(result.branchName, "worktree/ec86");
    assert.equal(result.worktreePath, target);
    await stat(join(target, "README.md"));
    const worktreeBranch = await execFileAsync("git", ["-C", target, "branch", "--show-current"]);
    assert.equal(worktreeBranch.stdout.trim(), "worktree/ec86");
    const unchangedBranch = await execFileAsync("git", ["-C", root, "branch", "--show-current"]);
    assert.equal(unchangedBranch.stdout.trim(), currentBranch.stdout.trim());
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("GitCliRepo skips occupied directories and existing branches while allocating an automatic worktree", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-auto-worktree-"));
  const existingDirectory = join(container, "ec86");
  const ids = ["ec86", "a741", "f02e"];
  const repo = createGitCliRepo({ generateWorktreeId: () => ids.shift() ?? "ffff" });

  try {
    await mkdir(existingDirectory);
    await writeFile(join(existingDirectory, "keep.txt"), "keep\n");
    await execFileAsync("git", ["-C", root, "branch", "worktree/a741"]);
    const result = await repo.createAutomaticWorktree(root, container);

    assert.equal(result.ok, true);
    assert.equal(result.branchName, "worktree/f02e");
    assert.equal(result.worktreePath, join(container, "f02e", basename(root)));
    assert.equal(await readFile(join(existingDirectory, "keep.txt"), "utf8"), "keep\n");
    const existingBranch = await execFileAsync("git", [
      "-C",
      root,
      "branch",
      "--list",
      "worktree/a741",
    ]);
    assert.match(existingBranch.stdout, /worktree\/a741/);
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("GitCliRepo reports exhausted automatic names without touching an existing directory", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-auto-worktree-"));
  const occupied = join(container, "ec86");
  let allocations = 0;
  const repo = createGitCliRepo({
    generateWorktreeId: () => {
      allocations += 1;
      return "ec86";
    },
  });

  try {
    await mkdir(occupied);
    await writeFile(join(occupied, "keep.txt"), "keep\n");
    const result = await repo.createAutomaticWorktree(root, container);

    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.code, "name-allocation-failed");
    assert.equal(allocations, 8);
    assert.equal(await readFile(join(occupied, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("IGitService exposes automatic worktree creation without changing explicit creation", async () => {
  const root = await createGitRepository();
  const container = await mkdtemp(join(tmpdir(), "zcode-auto-worktree-"));
  const service = createGitService({
    repo: createGitCliRepo({ generateWorktreeId: () => "cafe" }),
  });

  try {
    const result = await service.createAutomaticWorktree({
      workspacePath: root,
      worktreeRootPath: container,
    });
    assert.equal(result.ok, true);
    assert.equal(result.branchName, "worktree/cafe");
    assert.equal(result.worktreePath, join(container, "cafe", basename(root)));
  } finally {
    await rm(container, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
