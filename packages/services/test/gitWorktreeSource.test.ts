import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createGitCommandProvider } from "../src/git/providers/gitCommandProvider.js";

const exec = promisify(execFile);
async function fixture() {
  const container = await mkdtemp(join(tmpdir(), "zcode-worktree-source-"));
  const root = join(container, "repo");
  const target = join(container, "targets");
  const linked = join(container, "来源 工作树");
  const git = (path: string, ...args: string[]) => exec("git", ["-C", path, ...args]);
  await exec("git", ["init", "-q", "-b", "main", root]);
  await git(root, "config", "user.name", "ZCode Test");
  await git(root, "config", "user.email", "zcode@example.invalid");
  await writeFile(join(root, "file.txt"), "main\n");
  await git(root, "add", "file.txt");
  await git(root, "commit", "-qm", "initial");
  await git(root, "worktree", "add", "-b", "feature/来源", linked);
  await writeFile(join(linked, "file.txt"), "source\n");
  await git(linked, "commit", "-qam", "source change");
  const hash = (path: string, ref = "HEAD") =>
    git(path, "rev-parse", ref).then((result) => result.stdout.trim());
  return { container, root, target, linked, git, hash };
}

test("automatic creation derives from the selected occupied local branch, preserving both worktrees", async () => {
  const f = await fixture();
  try {
    const sourceCommit = await f.hash(f.linked);
    const mainCommit = await f.hash(f.root);
    await f.git(f.root, "tag", "feature/来源", mainCommit);
    await writeFile(join(f.root, "file.txt"), "unsaved main\n");
    await writeFile(join(f.linked, "file.txt"), "unsaved source\n");
    const service = createGitService({
      repo: createGitCliRepo({ generateWorktreeId: () => "cafe" }),
    });
    const result = await service.createAutomaticWorktree({
      workspacePath: f.root,
      worktreeRootPath: f.target,
      sourceBranchName: "feature/来源",
    });
    assert.equal(result.ok, true);
    assert.equal(result.worktreePath, join(f.target, "cafe", basename(f.root)));
    assert.equal(await f.hash(result.worktreePath), sourceCommit);
    assert.equal(await readFile(join(result.worktreePath, "file.txt"), "utf8"), "source\n");
    assert.equal(await f.hash(f.root), mainCommit);
    assert.equal(await f.hash(f.linked), sourceCommit);
    assert.equal(await readFile(join(f.root, "file.txt"), "utf8"), "unsaved main\n");
    assert.equal(await readFile(join(f.linked, "file.txt"), "utf8"), "unsaved source\n");
    const list = await f.git(f.root, "worktree", "list", "--porcelain");
    assert.ok(list.stdout.includes(await realpath(f.linked)));
  } finally {
    await rm(f.container, { recursive: true, force: true });
  }
});

test("explicit missing, invalid, tag-only and remote-only sources never fall back to HEAD", async () => {
  const f = await fixture();
  try {
    await f.git(f.root, "tag", "tag-only");
    await f.git(f.root, "update-ref", "refs/remotes/origin/remote-only", await f.hash(f.root));
    const service = createGitService({
      repo: createGitCliRepo({ generateWorktreeId: () => "cafe" }),
    });
    for (const source of [
      "",
      "invalid name",
      "deleted-branch",
      "tag-only",
      "origin/remote-only",
      "HEAD",
      "--detach",
    ]) {
      const result = await service.createAutomaticWorktree({
        workspacePath: f.root,
        worktreeRootPath: f.target,
        sourceBranchName: source,
      });
      assert.equal(result.ok, false, source);
      assert.equal(result.didCreate, false);
      assert.equal(result.issues[0]?.code, "target-branch-not-found", source);
    }
    assert.deepEqual(await readdir(f.container), ["repo", "来源 工作树"]);
  } finally {
    await rm(f.container, { recursive: true, force: true });
  }
});

test("allocation retries reuse one source commit even when its branch moves", async () => {
  const f = await fixture();
  try {
    const base = await f.hash(f.root);
    const next = await f.hash(f.linked);
    await f.git(f.root, "branch", "source", base);
    await f.git(f.root, "branch", "worktree/aaaa", base);
    const commands = createGitCommandProvider();
    const starts: string[] = [];
    const repo = createGitCliRepo({
      generateWorktreeId: (() => {
        const ids = ["aaaa", "bbbb"];
        return () => ids.shift() ?? "ffff";
      })(),
      commandProvider: {
        ...commands,
        async run(input) {
          const result = await commands.run(input);
          if (input.args[0] === "worktree" && input.args[1] === "add") {
            starts.push(input.args.at(-1)!);
            if (starts.length === 1) await f.git(f.root, "branch", "-f", "source", next);
          }
          return result;
        },
      },
    });
    const result = await createGitService({ repo }).createAutomaticWorktree({
      workspacePath: f.root,
      worktreeRootPath: f.target,
      sourceBranchName: "source",
    });
    assert.equal(result.ok, true);
    assert.equal(result.branchName, "worktree/bbbb");
    assert.equal(await f.hash(f.root, "source"), next);
    assert.equal(await f.hash(result.worktreePath), base);
    assert.deepEqual(starts, [base, base]);
  } finally {
    await rm(f.container, { recursive: true, force: true });
  }
});
