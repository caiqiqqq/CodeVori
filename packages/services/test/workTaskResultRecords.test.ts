import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";
const exec = promisify(execFile);

test("task records pin the task base, retain pending edits and only link remotely published commits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-result-records-"));
  const path = join(dir, "repo");
  const remote = join(dir, "remote.git");
  const git = (...args: string[]) => exec("git", ["-C", path, ...args]);
  try {
    await exec("git", ["init", "-b", "main", path]);
    await exec("git", ["init", "--bare", remote]);
    await git("config", "user.name", "Synthetic");
    await git("config", "user.email", "synthetic@example.invalid");
    await writeFile(join(path, "base.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "unrelated base");
    const baseCommit = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("switch", "-c", "task/result");
    await writeFile(join(path, "fix.txt"), "fix\n");
    await git("add", ".");
    await git("commit", "-m", "fix task");
    await git("remote", "add", "origin", remote);
    await writeFile(join(path, "pending.txt"), "pending\n");
    const service = createGitService();
    const request = {
      workspacePath: path,
      branchName: "task/result",
      baseCommit,
      remoteName: "origin",
      publishedBranches: ["task/result"],
    };
    const before = await service.getTaskChangeRecord(request);
    assert.equal(before.record.commits.length, 1);
    assert.equal(before.record.commits[0]?.subject, "fix task");
    assert.equal(before.record.commits[0]?.published, false);
    assert.deepEqual(
      before.record.uncommitted.map((f) => f.path),
      ["pending.txt"],
    );
    assert.deepEqual(
      before.record.files.map((f) => f.path),
      ["fix.txt"],
    );
    await git("push", "origin", "task/result");
    const after = await service.getTaskChangeRecord(request);
    assert.equal(after.record.commits[0]?.published, true);
    await assert.rejects(
      service.getTaskChangeRecord({ ...request, branchName: "main" }),
      /branch-mismatch/,
    );
    assert.equal((await git("status", "--porcelain")).stdout.trim(), "?? pending.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("clean, binary and unusual file names retain accurate records without a task base", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-result-files-"));
  const git = (...args: string[]) => exec("git", ["-C", dir, ...args]);
  try {
    await git("init", "-b", "task/result");
    await git("config", "user.name", "Synthetic");
    await git("config", "user.email", "synthetic@example.invalid");
    await writeFile(join(dir, "base.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "base");
    const baseCommit = (await git("rev-parse", "HEAD")).stdout.trim();
    const service = createGitService();
    const request = { workspacePath: dir, branchName: "task/result", baseCommit };
    const clean = await service.getTaskChangeRecord(request);
    assert.equal(clean.record.state, "known");
    assert.deepEqual(clean.record.files, []);
    assert.deepEqual(clean.record.commits, []);
    const name = "binary\twith\nnewline.bin";
    await writeFile(join(dir, name), new Uint8Array([0, 1, 2]));
    await git("add", "--", name);
    const pending = await service.getTaskChangeRecord({ ...request, baseCommit: undefined });
    assert.equal(pending.record.state, "partial");
    assert.deepEqual(pending.record.commits, []);
    assert.deepEqual(pending.record.uncommitted, [{ path: name, added: null, removed: null }]);
    await git("commit", "-m", "binary update");
    const committed = await service.getTaskChangeRecord(request);
    assert.deepEqual(committed.record.files, [{ path: name, added: null, removed: null }]);
    await assert.rejects(
      service.getTaskChangeRecord({ ...request, workspacePath: join(dir, "missing") }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
