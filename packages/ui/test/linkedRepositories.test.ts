import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createGitService } from "../../services/src/git/gitService.js";
import {
  prepareLinkedRepositories,
  LinkedRepositoryError,
} from "../src/lib/linkedRepositoryPreparation.js";
import {
  buildPromptWithLinkedRepositories,
  parsePromptLinkedRepositories,
} from "../src/lib/linkedRepositoryContext.js";
import type { LinkedRepository } from "@zcode/shared";

const exec = promisify(execFile);
async function repository(root: string) {
  await exec("git", ["init", "-q", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.name", "ZCode Test"]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await writeFile(join(root, "app.txt"), "main\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-qm", "main"]);
  await exec("git", ["-C", root, "checkout", "-qb", "test"]);
  await writeFile(join(root, "app.txt"), "test\n");
  await exec("git", ["-C", root, "commit", "-qam", "test"]);
  await exec("git", ["-C", root, "checkout", "-q", "main"]);
}

test("linked repo starts from selected branch and retry reuses the persisted successful allocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-linked-repos-"));
  const gitService = createGitService();
  const backend = join(root, "backend");
  let saved: LinkedRepository[] = [
    { name: "backend", sourcePath: backend, baseBranch: "test", useWorktree: true },
  ];
  try {
    await repository(backend);
    await writeFile(join(backend, "app.txt"), "uncommitted\n");
    const prepare = () =>
      prepareLinkedRepositories({
        repositories: saved,
        gitService,
        worktreeRootPath: join(root, "trees"),
        onPrepared: (rows) => {
          saved = rows;
        },
        isCurrent: () => true,
      });
    const first = await prepare();
    assert.equal(
      await readFile(join(first[0].prepared!.executionPath, "app.txt"), "utf8"),
      "test\n",
    );
    assert.equal(await readFile(join(backend, "app.txt"), "utf8"), "uncommitted\n");
    assert.equal(
      (await exec("git", ["-C", backend, "branch", "--show-current"])).stdout.trim(),
      "main",
    );
    saved.push({
      name: "missing",
      sourcePath: join(root, "missing"),
      baseBranch: "main",
      useWorktree: true,
    });
    await assert.rejects(prepare(), LinkedRepositoryError);
    saved = saved.slice(0, 1);
    assert.deepEqual(await prepare(), first);
    const trees = (await exec("git", ["-C", backend, "worktree", "list", "--porcelain"])).stdout;
    assert.equal(trees.match(/^worktree /gm)?.length, 2);
    await exec("git", ["-C", first[0].prepared!.executionPath, "checkout", "-qb", "external"]);
    await assert.rejects(
      prepare(),
      (error: unknown) => error instanceof LinkedRepositoryError && error.code === "bindingChanged",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a late successful Git result is recorded before aborting an obsolete send", async () => {
  let current = true;
  let recorded = false;
  const gitService = {
    getWorkspaceRepositoryInfo: async () => ({
      kind: "main-tree",
      repoRoot: "/backend",
      mainWorktreePath: null,
    }),
    resolveLocalBranch: async () => ({ commitHash: "commit" }),
    createAutomaticWorktree: async () => {
      current = false;
      return { ok: true, worktreePath: "/trees/backend", branchName: "worktree/one" };
    },
  } as unknown as Parameters<typeof prepareLinkedRepositories>[0]["gitService"];
  await assert.rejects(
    prepareLinkedRepositories({
      repositories: [
        { name: "backend", sourcePath: "/backend", baseBranch: "main", useWorktree: true },
      ],
      gitService,
      worktreeRootPath: "/trees",
      onPrepared: () => {
        recorded = true;
      },
      isCurrent: () => current,
    }),
    /stale/,
  );
  assert.equal(recorded, true);
});

test("directory guidance roundtrips without altering body or accepting invalid metadata", () => {
  const rows: LinkedRepository[] = [
    {
      name: "backend",
      sourcePath: "/source/backend",
      baseBranch: "main",
      useWorktree: true,
      prepared: {
        executionPath: "/trees/backend",
        branchName: "worktree/one",
        baseCommit: "commit",
        sourceRepositoryPath: "/source/backend",
      },
    },
  ];
  const prompt = buildPromptWithLinkedRepositories("Implement API", rows);
  assert.match(prompt, /\/trees\/backend/);
  assert.match(prompt, /executionPath/);
  assert.deepEqual(parsePromptLinkedRepositories(prompt), {
    visibleContent: "Implement API",
    repositories: rows,
  });
  assert.equal(buildPromptWithLinkedRepositories("plain", []), "plain");
  assert.equal(buildPromptWithLinkedRepositories("/goal fix API", rows), "/goal fix API");
  assert.equal(
    parsePromptLinkedRepositories(
      "user text <zcode-linked-repositories>garbage</zcode-linked-repositories>",
    ).repositories.length,
    0,
  );
});

test("existing worktree reuse allocates nothing and rejects a missing execution directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-linked-reuse-"));
  const backend = join(root, "backend");
  const existing = join(root, "existing");
  const service = createGitService();
  let saved: LinkedRepository[] = [
    { name: "backend", sourcePath: existing, baseBranch: "feature", useWorktree: false },
  ];
  try {
    await repository(backend);
    await exec("git", ["-C", backend, "worktree", "add", "-qb", "feature", existing, "main"]);
    const prepare = () =>
      prepareLinkedRepositories({
        repositories: saved,
        gitService: service,
        worktreeRootPath: join(root, "trees"),
        onPrepared: (rows) => {
          saved = rows;
        },
        isCurrent: () => true,
      });
    assert.equal((await prepare())[0].prepared!.executionPath, existing);
    assert.deepEqual(await prepare(), saved);
    assert.equal(
      (await exec("git", ["-C", backend, "worktree", "list", "--porcelain"])).stdout.match(
        /^worktree /gm,
      )?.length,
      2,
    );
    await exec("git", ["-C", backend, "worktree", "remove", existing]);
    await assert.rejects(prepare(), LinkedRepositoryError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("obsolete preparation performs no repository IO", async () => {
  await assert.rejects(
    prepareLinkedRepositories({
      repositories: [
        { name: "backend", sourcePath: "/backend", baseBranch: "main", useWorktree: true },
      ],
      gitService: {} as never,
      worktreeRootPath: "/trees",
      onPrepared: () => assert.fail("Must not save"),
      isCurrent: () => false,
    }),
    /stale/,
  );
});
