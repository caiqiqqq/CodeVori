import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { parseGitBranchMutationIssues } from "../src/git/repo/gitCliHelpers.js";

const exec = promisify(execFile);

for (const wording of ["is already checked out at", "is already used by worktree at"]) {
  test(`branch occupancy normalizes Git's '${wording}' wording`, () => {
    const path = "/synthetic/工作树 with space/feature's directory";
    const stderr = `fatal: 'feature/修复' ${wording} '${path}'\n`;
    const issues = parseGitBranchMutationIssues({
      binaryPath: "git",
      cwd: "/synthetic/repository",
      args: ["switch", "--no-guess", "feature/修复"],
      exitCode: 128,
      stdout: "",
      stderr,
      signal: null,
      durationMs: 1,
      timedOut: false,
      outputTruncated: false,
    });
    assert.equal(issues[0]?.code, "branch-in-other-worktree");
    assert.deepEqual(issues[0]?.paths, [path]);
    assert.equal(issues[0]?.detail, stderr.trim());
  });
}

test("local branches expose worktree occupancy and preserve Git switch safety", async () => {
  const container = await mkdtemp(join(tmpdir(), "zcode-branch-switcher-"));
  const root = join(container, "repository");
  const linked = join(container, "工作树 with space");
  const repo = createGitCliRepo();
  const git = (...args: string[]) => exec("git", ["-C", root, ...args]);
  try {
    await exec("git", ["init", "-q", "-b", "main", root]);
    await git("config", "user.name", "ZCode Test");
    await git("config", "user.email", "zcode@example.invalid");
    await writeFile(join(root, "README.md"), "initial\n");
    await git("add", "README.md");
    await git("commit", "-qm", "initial");
    await git("branch", "feature/free");
    await git("worktree", "add", "-b", "feature/占用", linked);
    const newlinePath = join(container, "目录\nwith newline");
    await git("worktree", "add", "-b", "feature/newline-path", newlinePath);

    const list = await repo.listLocalBranches(root);
    assert.equal(list.branches.length, 4);
    assert.equal(
      list.branches.find((branch) => branch.name === "feature/newline-path")?.worktreePath,
      await realpath(newlinePath),
    );
    await git("worktree", "remove", newlinePath);
    assert.equal(list.currentBranchName, "main");
    assert.equal(
      list.branches.find((branch) => branch.name === "main")?.worktreePath,
      await realpath(root),
    );
    assert.equal(
      list.branches.find((branch) => branch.name === "feature/free")?.worktreePath,
      null,
    );
    assert.equal(
      list.branches.find((branch) => branch.name === "feature/占用")?.worktreePath,
      await realpath(linked),
    );

    const noop = await repo.switchBranch(root, "main");
    assert.equal(noop.ok, true);
    assert.equal(noop.didChange, false);
    const blocked = await repo.switchBranch(root, "feature/占用");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.didChange, false);
    assert.equal(blocked.issues[0]?.code, "branch-in-other-worktree");
    assert.deepEqual(blocked.issues[0]?.paths, [await realpath(linked)]);
    assert.equal((await git("branch", "--show-current")).stdout.trim(), "main");
    assert.equal(
      (await exec("git", ["-C", linked, "branch", "--show-current"])).stdout.trim(),
      "feature/占用",
    );
    assert.equal(await readFile(join(root, "README.md"), "utf8"), "initial\n");
    assert.equal(await readFile(join(linked, "README.md"), "utf8"), "initial\n");

    const available = await repo.switchBranch(root, "feature/free");
    assert.equal(available.ok, true);
    assert.equal(available.didChange, true);
    const linkedList = await repo.listLocalBranches(linked);
    assert.equal(linkedList.currentBranchName, "feature/占用");
    assert.equal(
      linkedList.branches.find((branch) => branch.name === "feature/free")?.worktreePath,
      await realpath(root),
    );
    await git("worktree", "remove", linked);
    assert.equal(
      (await repo.listLocalBranches(root)).branches.find((branch) => branch.name === "feature/占用")
        ?.worktreePath,
      null,
    );
    assert.equal((await repo.switchBranch(root, "feature/占用")).ok, true);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});
