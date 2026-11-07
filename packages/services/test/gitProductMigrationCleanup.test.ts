import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";
import { createGitCommandProvider } from "../src/git/providers/gitCommandProvider.js";
import { syncProductMigrationGitExcludes } from "../src/git/repo/productMigrationGitExcludes.js";

const exec = promisify(execFile);
const marker = ".codevori/.product-path-migration-v2.json";

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "zcode-migration-cleanup-")));
  const project = join(directory, "project");
  const root = join(directory, "managed");
  const target = join(root, "abcd", "project");
  await mkdir(project);
  await exec("git", ["init", "-q", project]);
  await exec("git", ["-C", project, "config", "user.name", "ZCode Test"]);
  await exec("git", ["-C", project, "config", "user.email", "zcode@example.invalid"]);
  await writeFile(join(project, "file.txt"), "initial\n");
  await exec("git", ["-C", project, "add", "."]);
  await exec("git", ["-C", project, "commit", "-qm", "initial"]);
  await exec("git", ["-C", project, "worktree", "add", "-qb", "worktree/abcd", target]);
  const exclude = join(project, ".git/info/exclude");
  await writeFile(exclude, "# keep original rules\n/.zcodeignore");
  await mkdir(join(target, ".codevori"));
  await writeFile(join(target, marker), '{"version":2,"status":"complete"}\n');
  await writeFile(join(target, ".zcodeignore"), "*.private\n");
  await writeFile(join(target, ".codevoriignore"), "*.private\n");
  const input = {
    worktreeRootPath: root,
    worktreePath: target,
    projectPath: project,
    expectedBranchName: "worktree/abcd",
  };
  return { directory, project, target, exclude, input };
}

test("completed path migration inherits local ignores before non-force task cleanup", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await createGitService().removeManagedWorktree(f.input), { ok: true });
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    assert.match(await readFile(f.exclude, "utf8"), /^# keep original rules\n\/\.zcodeignore\n/);
    await exec("git", ["-C", f.project, "show-ref", "--verify", "refs/heads/worktree/abcd"]);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  "different-copy",
  "legacy-visible",
  "explicit-include",
  "incomplete-marker",
  "symlink-copy",
  "symlink-directory",
  "other-config",
  "tracked-change",
] as const) {
  test(`migration cleanup preserves dirty worktrees with ${scenario}`, async () => {
    const f = await fixture();
    try {
      if (scenario === "different-copy") await writeFile(join(f.target, ".codevoriignore"), "new");
      if (scenario === "legacy-visible") await writeFile(f.exclude, "# legacy is not ignored\n");
      if (scenario === "explicit-include")
        await writeFile(f.exclude, "# user choice\n/.zcodeignore\n!/.codevoriignore\n");
      if (scenario === "incomplete-marker")
        await writeFile(join(f.target, marker), '{"version":2,"status":"running"}\n');
      if (scenario === "symlink-copy") {
        await rm(join(f.target, ".codevoriignore"));
        await symlink(".zcodeignore", join(f.target, ".codevoriignore"));
      }
      if (scenario === "symlink-directory") {
        await mkdir(join(f.directory, "external"));
        await writeFile(
          join(f.directory, "external/.product-path-migration-v2.json"),
          '{"version":2,"status":"complete"}\n',
        );
        await rm(join(f.target, ".codevori"), { recursive: true });
        await symlink(join(f.directory, "external"), join(f.target, ".codevori"), "dir");
      }
      if (scenario === "other-config")
        await writeFile(join(f.target, ".codevori/config.json"), "{}\n");
      if (scenario === "tracked-change") await writeFile(join(f.target, "file.txt"), "edited\n");
      assert.deepEqual(await createGitService().removeManagedWorktree(f.input), {
        ok: false,
        issue: "dirty-worktree",
      });
      await stat(f.target);
      if (scenario === "tracked-change")
        assert.equal(await readFile(join(f.target, "file.txt"), "utf8"), "edited\n");
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("concurrent migration ignore repairs are idempotent and retain exact configuration scope", async () => {
  const f = await fixture();
  try {
    const commands = createGitCommandProvider();
    await Promise.all(
      Array.from({ length: 8 }, () => syncProductMigrationGitExcludes(f.target, commands)),
    );
    const rules = (await readFile(f.exclude, "utf8")).split("\n");
    assert.equal(rules.filter((line) => line === `/${marker}`).length, 1);
    assert.equal(rules.filter((line) => line === "/.codevoriignore").length, 1);
    await writeFile(join(f.target, ".codevori/config.json"), "{}\n");
    const status = await exec("git", [
      "-C",
      f.target,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    assert.equal(status.stdout, "?? .codevori/config.json\n");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
