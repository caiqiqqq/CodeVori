import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { createGitCommandProvider } from "../src/git/providers/gitCommandProvider.js";

const exec = promisify(execFile);

for (const durationMs of [16_000, 121_000]) {
  test(`directory removal with ${durationMs}ms elapsed honors its budget and runtime barrier`, async () => {
    const f = await fixture();
    const commands = createGitCommandProvider();
    let held = false;
    let removed = false;
    const service = createGitService({
      repo: createGitCliRepo({
        commandProvider: {
          resolveGitBinary: () => commands.resolveGitBinary(),
          run: async (input) => {
            if (input.args[0] !== "worktree" || input.args[1] !== "remove") {
              assert.equal(input.timeoutMs, 15_000);
              return commands.run(input);
            }
            assert.equal(held, true);
            // 模拟真实日志中超过 15 秒的磁盘删除，不让回归测试实际等待慢磁盘。
            if ((input.timeoutMs ?? 15_000) < durationMs) {
              const result = await commands.run({ ...input, args: ["--version"] });
              return { ...result, durationMs: input.timeoutMs!, exitCode: null, timedOut: true };
            }
            const result = await commands.run(input);
            removed = result.exitCode === 0;
            return { ...result, durationMs };
          },
        },
      }),
      prepareWorktreeRemoval: async () => {
        held = true;
        return {
          dispose: () => {
            held = false;
          },
        };
      },
    });
    try {
      assert.deepEqual(
        await service.removeManagedWorktree({
          worktreeRootPath: f.root,
          worktreePath: f.target,
          projectPath: f.project,
          expectedBranchName: "worktree/abcd",
        }),
        durationMs === 16_000 ? { ok: true } : { ok: false, issue: "command-failed" },
      );
      assert.equal(removed, durationMs === 16_000);
      assert.equal(held, false);
      if (removed) await assert.rejects(stat(f.target), { code: "ENOENT" });
      else await stat(join(f.target, "file.txt"));
      await exec("git", ["-C", f.project, "show-ref", "--verify", "refs/heads/worktree/abcd"]);
      await stat(join(f.outside, "file.txt"));
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

for (const outcome of ["success", "invalid-target", "command-failed", "exception"] as const) {
  test(`runtime startup barrier stays held through Git removal and releases on ${outcome}`, async () => {
    const f = await fixture();
    const commands = createGitCommandProvider();
    let held = false;
    let releases = 0;
    let removeCalls = 0;
    const service = createGitService({
      repo: createGitCliRepo({
        commandProvider: {
          resolveGitBinary: () => commands.resolveGitBinary(),
          run: async (input) => {
            if (input.args[0] === "worktree" && input.args[1] === "remove") {
              removeCalls++;
              assert.equal(held, true, "runtime cannot restart during the removal command");
              if (outcome === "exception") throw new Error("removal fixture failure");
              if (outcome === "command-failed") {
                const result = await commands.run({ ...input, args: ["--version"] });
                return { ...result, exitCode: 1 };
              }
            }
            return commands.run(input);
          },
        },
      }),
      prepareWorktreeRemoval: async () => {
        held = true;
        if (outcome === "invalid-target")
          await exec("git", ["-C", f.target, "switch", "-qc", "replacement"]);
        return {
          dispose: () => {
            assert.equal(held, true);
            held = false;
            releases++;
          },
        };
      },
    });
    try {
      const result = await service.removeManagedWorktree({
        worktreeRootPath: f.root,
        worktreePath: f.target,
        projectPath: f.project,
        expectedBranchName: "worktree/abcd",
      });
      assert.deepEqual(
        result,
        outcome === "success"
          ? { ok: true }
          : { ok: false, issue: outcome === "exception" ? "command-failed" : outcome },
      );
      assert.equal(releases, 1);
      assert.equal(held, false);
      assert.equal(removeCalls, outcome === "invalid-target" ? 0 : 1);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("task cleanup rechecks the allocated branch after runtime preparation", async () => {
  const f = await fixture();
  const service = createGitService({
    prepareWorktreeRemoval: async () => {
      await exec("git", ["-C", f.target, "switch", "-qc", "replacement"]);
      return null;
    },
  });
  try {
    const result = await service.removeManagedWorktree({
      worktreeRootPath: f.root,
      worktreePath: f.target,
      projectPath: f.project,
      expectedBranchName: "worktree/abcd",
    });
    assert.equal(result.issue, "invalid-target");
    await stat(join(f.target, "file.txt"));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("task cleanup verifies the allocated branch and permits retry only after unregistering", async () => {
  const f = await fixture();
  const service = createGitService();
  const input = {
    worktreeRootPath: f.root,
    worktreePath: f.target,
    projectPath: f.project,
    expectedBranchName: "worktree/abcd",
    allowMissing: true,
  };
  try {
    assert.equal(
      (await service.removeManagedWorktree({ ...input, expectedBranchName: "other" })).issue,
      "invalid-target",
    );
    await writeFile(join(f.target, "keep.txt"), "keep");
    assert.equal((await service.removeManagedWorktree(input)).issue, "dirty-worktree");
    await rm(join(f.target, "keep.txt"));
    assert.deepEqual(await service.removeManagedWorktree(input), { ok: true });
    assert.deepEqual(await service.removeManagedWorktree(input), { ok: true });
    await exec("git", ["-C", f.project, "show-ref", "--verify", "refs/heads/worktree/abcd"]);
    await stat(join(f.outside, "file.txt"));
    await stat(join(f.project, "file.txt"));
    await exec("git", ["-C", f.project, "worktree", "add", "-q", f.target, "worktree/abcd"]);
    await rm(f.target, { recursive: true });
    assert.equal(
      (await service.removeManagedWorktree(input)).issue,
      "invalid-target",
      "missing but registered directory is not a successful removal",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "zcode-managed-worktrees-")));
  const project = join(directory, "project with spaces");
  const root = join(directory, "managed");
  const outside = join(directory, "managed-other", "outside");
  const target = join(root, "abcd", "project");
  await mkdir(project);
  await exec("git", ["init", "-q", project]);
  await exec("git", ["-C", project, "config", "user.name", "ZCode Test"]);
  await exec("git", ["-C", project, "config", "user.email", "zcode@example.invalid"]);
  await writeFile(join(project, "file.txt"), "initial\n");
  await exec("git", ["-C", project, "add", "."]);
  await exec("git", ["-C", project, "commit", "-qm", "initial"]);
  await exec("git", ["-C", project, "worktree", "add", "-qb", "worktree/abcd", target]);
  await exec("git", ["-C", project, "worktree", "add", "-qb", "outside", outside]);
  return { directory, project, root, target, outside };
}

test("managed worktrees are discovered without tabs, grouped by Git project and scoped to the configured root", async () => {
  const f = await fixture();
  const service = createGitService();
  try {
    const projects = await service.listManagedWorktrees({ worktreeRootPath: f.root });
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.projectPath, f.project);
    assert.deepEqual(
      projects[0]?.worktrees.map((item) => item.worktreePath),
      [f.target],
    );
    assert.equal(projects[0]?.worktrees[0]?.branchName, "worktree/abcd");
    assert.deepEqual(
      await service.listManagedWorktrees({ worktreeRootPath: join(f.directory, "missing") }),
      [],
    );
    await assert.rejects(service.listManagedWorktrees({ worktreeRootPath: "relative" }));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a registered worktree directly beneath the configured root is visible too", async () => {
  const f = await fixture();
  const direct = join(f.root, "direct");
  try {
    await exec("git", ["-C", f.project, "worktree", "add", "-qb", "direct", direct]);
    const projects = await createGitService().listManagedWorktrees({ worktreeRootPath: f.root });
    assert.deepEqual(
      projects[0]?.worktrees.map(({ worktreePath }) => worktreePath),
      [f.target, direct],
    );
    assert.ok(!projects[0]?.worktrees.some(({ worktreePath }) => worktreePath === f.outside));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("managed discovery excludes symlink escapes, main trees and unregistered directories", async () => {
  const f = await fixture();
  const service = createGitService();
  try {
    await symlink(f.outside, join(f.root, "external-link"), "dir");
    await mkdir(join(f.root, "ordinary-folder"));
    await writeFile(join(f.root, "ordinary-folder", "keep.txt"), "keep");
    const projects = await service.listManagedWorktrees({ worktreeRootPath: f.directory });
    assert.equal(projects.length, 1);
    assert.ok(!projects[0]?.worktrees.some((item) => item.worktreePath === f.project));
    const scoped = await service.listManagedWorktrees({ worktreeRootPath: f.root });
    assert.deepEqual(
      scoped.flatMap((item) => item.worktrees.map((tree) => tree.worktreePath)),
      [f.target],
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("removing a clean managed worktree unregisters it, retains its branch and preserves neighbours", async () => {
  const f = await fixture();
  let prepared: string | null = null;
  const service = createGitService({
    prepareWorktreeRemoval: async (path) => {
      prepared = path;
      return null;
    },
  });
  try {
    const result = await service.removeManagedWorktree({
      worktreeRootPath: f.root,
      worktreePath: f.target,
      projectPath: f.project,
    });
    assert.equal(result.ok, true);
    assert.equal(prepared, f.target);
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    await assert.rejects(stat(join(f.root, "abcd")), { code: "ENOENT" });
    await stat(join(f.outside, "file.txt"));
    await exec("git", ["-C", f.project, "show-ref", "--verify", "refs/heads/worktree/abcd"]);
    assert.deepEqual(await service.listManagedWorktrees({ worktreeRootPath: f.root }), []);
    assert.equal(
      (
        await service.removeManagedWorktree({
          worktreeRootPath: f.root,
          worktreePath: f.target,
          projectPath: f.project,
        })
      ).ok,
      false,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("removal rechecks strict containment, Git ownership and worktree registration before touching runtimes", async () => {
  const f = await fixture();
  let prepared = 0;
  const service = createGitService({
    prepareWorktreeRemoval: async () => {
      prepared++;
      return null;
    },
  });
  try {
    await symlink(f.outside, join(f.root, "external-link"), "dir");
    for (const target of [f.outside, f.root, f.project, join(f.root, "external-link")]) {
      const result = await service.removeManagedWorktree({
        worktreeRootPath: f.root,
        worktreePath: target,
        projectPath: f.project,
      });
      assert.equal(result.ok, false);
    }
    const wrongProject = await service.removeManagedWorktree({
      worktreeRootPath: f.root,
      worktreePath: f.target,
      projectPath: f.outside,
    });
    assert.equal(wrongProject.ok, false);
    assert.equal(prepared, 0);
    await stat(join(f.target, "file.txt"));
    await stat(join(f.outside, "file.txt"));
    await stat(join(f.project, "file.txt"));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("dirty, locked and busy managed worktrees are rejected without force deletion", async () => {
  const f = await fixture();
  let prepareCalls = 0;
  const service = createGitService({
    prepareWorktreeRemoval: async () => {
      prepareCalls++;
      return "workspace-busy";
    },
  });
  const input = { worktreeRootPath: f.root, worktreePath: f.target, projectPath: f.project };
  try {
    await writeFile(join(f.target, "untracked.txt"), "keep");
    assert.equal((await service.removeManagedWorktree(input)).issue, "dirty-worktree");
    assert.equal(await readFile(join(f.target, "untracked.txt"), "utf8"), "keep");
    assert.equal(prepareCalls, 0);
    await rm(join(f.target, "untracked.txt"));
    await exec("git", ["-C", f.project, "worktree", "lock", f.target]);
    assert.equal((await service.removeManagedWorktree(input)).issue, "locked-worktree");
    assert.equal(prepareCalls, 0);
    await exec("git", ["-C", f.project, "worktree", "unlock", f.target]);
    assert.equal((await service.removeManagedWorktree(input)).issue, "workspace-busy");
    assert.equal(prepareCalls, 1);
    await stat(join(f.target, "file.txt"));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("concurrent deletion of the same worktree enters runtime preparation only once", async () => {
  const f = await fixture();
  let prepareCalls = 0;
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createGitService({
    prepareWorktreeRemoval: async () => {
      prepareCalls++;
      await prepared;
      return null;
    },
  });
  try {
    const input = { worktreeRootPath: f.root, worktreePath: f.target, projectPath: f.project };
    const first = service.removeManagedWorktree(input);
    const second = service.removeManagedWorktree(input);
    release();
    const results = await Promise.all([first, second]);
    assert.equal(prepareCalls, 1);
    assert.ok(results.some((result) => result.ok));
  } finally {
    release();
    await rm(f.directory, { recursive: true, force: true });
  }
});
