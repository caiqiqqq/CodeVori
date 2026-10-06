import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createGitCommandProvider,
  type GitCommandExecutionOptions,
  type GitCommandProvider,
} from "../src/git/providers/gitCommandProvider.js";
import { hasGitWorktreeChanges } from "../src/git/repo/gitWorktreeChanges.js";

const nodeProvider = createGitCommandProvider({
  getConfiguredGitPath: async () => process.execPath,
  timeoutKillGraceMs: 10,
  timeoutForceKillGraceMs: 50,
});

function capture(script: string, options?: Partial<GitCommandExecutionOptions>) {
  return nodeProvider.run({
    cwd: process.cwd(),
    args: ["-e", script],
    maxOutputBytes: 32,
    timeoutMs: 5_000,
    ...options,
  });
}

function scriptProvider(
  script: string,
  options?: Partial<GitCommandExecutionOptions>,
): GitCommandProvider {
  return {
    ...nodeProvider,
    run: (input) => capture(script, { ...input, ...options, args: ["-e", script] }),
  };
}

test("ordinary Git commands still capture full output and enforce the output quota", async () => {
  const small = await capture('process.stdout.write("full output"); process.stderr.write("warn");');
  assert.equal(small.stdout, "full output");
  assert.equal(small.stderr, "warn");
  assert.equal(small.exitCode, 0);
  assert.equal(small.outputTruncated, false);
  const large = await capture('process.stdout.write("x".repeat(2 * 1024 * 1024));');
  assert.equal(large.outputTruncated, true);
});

test("first-byte capture drains megabytes of stdout and waits for the real exit", async () => {
  const result = await capture(
    'process.stdout.write("1" + "x".repeat(2 * 1024 * 1024), () => process.stderr.write("completed"));',
    { stdoutCapture: "first-byte" },
  );
  assert.equal(result.stdout, "1");
  assert.equal(result.stderr, "completed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputTruncated, false);
});

test("worktree presence queries request collapsed, headerless status and bounded stdout", async () => {
  let received: GitCommandExecutionOptions | undefined;
  const delegate = scriptProvider('process.stdout.write("1" + "x".repeat(2 * 1024 * 1024));');
  const provider: GitCommandProvider = {
    ...delegate,
    run(input) {
      received = input;
      return delegate.run(input);
    },
  };
  assert.equal(await hasGitWorktreeChanges(provider, process.cwd()), true);
  assert.equal(received?.cwd, process.cwd());
  assert.equal(received?.stdoutCapture, "first-byte");
  assert.deepEqual(received?.args, [
    "status",
    "--porcelain=v2",
    "--untracked-files=normal",
    "--no-branch",
    "--no-show-stash",
    "-z",
  ]);
  assert.equal(await hasGitWorktreeChanges(scriptProvider(""), process.cwd()), false);
});

for (const prefix of ["", "1"]) {
  test(`status failure after ${prefix ? "nonempty" : "empty"} stdout cannot be accepted`, async () => {
    const provider = scriptProvider(
      `process.stdout.write(${JSON.stringify(prefix)}, () => {
        process.stderr.write("fatal: failed query");
        process.exitCode = 7;
      });`,
    );
    await assert.rejects(hasGitWorktreeChanges(provider, process.cwd()), /git status failed/);
  });
}

test("first-byte capture still fails on stderr overflow", async () => {
  const provider = scriptProvider(
    'process.stdout.write("1", () => process.stderr.write("x".repeat(1024)));',
  );
  await assert.rejects(
    hasGitWorktreeChanges(provider, process.cwd()),
    /git status output exceeded limit/,
  );
});

test("a status timeout is not accepted after seeing stdout", async () => {
  const provider = scriptProvider('process.stdout.write("1"); setInterval(() => {}, 1000);', {
    timeoutMs: 300,
  });
  await assert.rejects(hasGitWorktreeChanges(provider, process.cwd()), /git status timed out/);
});

test("status rejects truncated success results and unavailable working directories", async (t) => {
  const provider = scriptProvider("");
  const truncated: GitCommandProvider = {
    ...provider,
    async run(input) {
      return { ...(await provider.run(input)), outputTruncated: true };
    },
  };
  await assert.rejects(
    hasGitWorktreeChanges(truncated, process.cwd()),
    /git status output exceeded limit/,
  );
  const root = await mkdtemp(join(tmpdir(), "zcode-status-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(hasGitWorktreeChanges(provider, join(root, "missing")), /git status failed/);
});

test("real status includes untracked directories and tracked changes but not ignored files or headers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-status-presence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const execute = promisify(execFile);
  const git = (args: string[]) => execute("git", ["-C", root, ...args]);
  await git(["init", "-q"]);
  await git(["config", "user.name", "Status Test"]);
  await git(["config", "user.email", "status@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "initial\n");
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await git(["add", "."]);
  await git(["commit", "-qm", "initial"]);
  await git(["config", "status.branch", "true"]);
  await git(["config", "status.showStash", "true"]);
  await git(["config", "status.showUntrackedFiles", "no"]);
  await writeFile(join(root, "tracked.txt"), "stashed\n");
  await git(["stash", "push", "-qm", "test stash"]);
  const provider = createGitCommandProvider({ getConfiguredGitPath: async () => "git" });
  assert.equal(await hasGitWorktreeChanges(provider, root), false);
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, "ignored", "file.txt"), "ignored\n");
  assert.equal(await hasGitWorktreeChanges(provider, root), false);
  await mkdir(join(root, "untracked"));
  for (let index = 0; index < 50; index++)
    await writeFile(join(root, "untracked", `file ${index}.txt`), "new\n");
  assert.equal(await hasGitWorktreeChanges(provider, root), true);
  await git(["add", "untracked"]);
  assert.equal(await hasGitWorktreeChanges(provider, root), true);
  await git(["commit", "-qm", "track files"]);
  assert.equal(await hasGitWorktreeChanges(provider, root), false);
  await writeFile(join(root, "tracked.txt"), "changed\n");
  assert.equal(await hasGitWorktreeChanges(provider, root), true);
});
