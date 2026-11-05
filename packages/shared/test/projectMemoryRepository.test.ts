import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { resolveProjectMemoryRoot, resolveProjectMemoryScope } from "../src/node/projectMemory.js";
import { prepareProjectMemoryScope } from "../src/node/projectMemoryMigration.js";

test("linked worktrees share repository memory without merging separate clones", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-project-memory-scope-"));
  const cliStorageRoot = join(root, "store");
  const main = join(root, "main", "zcode");
  const linked = join(root, "linked", "zcode");
  const clone = join(root, "clone", "zcode");
  try {
    await mkdir(join(main, ".git", "worktrees", "linked"), { recursive: true });
    await mkdir(linked, { recursive: true });
    await mkdir(join(clone, ".git"), { recursive: true });
    const linkedGitDir = join(main, ".git", "worktrees", "linked");
    await writeFile(join(linked, ".git"), `gitdir: ${relative(linked, linkedGitDir)}\n`);
    await writeFile(join(linkedGitDir, "commondir"), "../..\n");

    const mainScope = await resolveProjectMemoryScope({ cliStorageRoot, workspacePath: main });
    const linkedScope = await resolveProjectMemoryScope({ cliStorageRoot, workspacePath: linked });
    const cloneScope = await resolveProjectMemoryScope({ cliStorageRoot, workspacePath: clone });
    assert.equal(mainScope.kind, "repository");
    assert.equal(mainScope.root, linkedScope.root);
    assert.equal(mainScope.displayPath, await realpath(main));
    assert.notEqual(mainScope.root, cloneScope.root);
    assert.equal(
      linkedScope.legacyRoot,
      resolveProjectMemoryRoot({ cliStorageRoot, workspacePath: linked }),
    );
    assert.notEqual(linkedScope.root, linkedScope.legacyRoot);

    const remote = await resolveProjectMemoryScope({
      cliStorageRoot,
      workspacePath: linked,
      workspaceIdentity: "remote:one",
    });
    assert.equal(remote.kind, "identity");
    assert.equal(remote.workspaceIdentity, "remote:one");
    assert.notEqual(remote.root, linkedScope.root);
    assert.equal(
      remote.root,
      resolveProjectMemoryRoot({
        cliStorageRoot,
        workspacePath: linked,
        workspaceIdentity: "remote:one",
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-Git workspaces retain their path-specific memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-project-memory-fallback-"));
  try {
    const workspacePath = join(root, "plain", "zcode");
    await mkdir(workspacePath, { recursive: true });
    const scope = await resolveProjectMemoryScope({ cliStorageRoot: root, workspacePath });
    assert.equal(scope.kind, "workspace");
    assert.equal(scope.root, resolveProjectMemoryRoot({ cliStorageRoot: root, workspacePath }));
    assert.equal(scope.legacyRoot, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy memory migrates once and preserves conflicting facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-project-memory-migration-"));
  const cliStorageRoot = join(root, "store");
  const workspacePath = join(root, "zcode");
  try {
    await mkdir(join(workspacePath, ".git"), { recursive: true });
    const scope = await resolveProjectMemoryScope({ cliStorageRoot, workspacePath });
    assert.ok(scope.legacyRoot);
    await mkdir(scope.legacyRoot, { recursive: true });
    await mkdir(scope.root, { recursive: true });
    await writeFile(
      join(scope.legacyRoot, "MEMORY.md"),
      "# Project memory\n- [Old](fact.md) — old\n",
    );
    await writeFile(join(scope.legacyRoot, "fact.md"), "---\nname: fact\n---\nold fact\n");
    await writeFile(join(scope.root, "MEMORY.md"), "- [New](fact.md) — new\n");
    await writeFile(join(scope.root, "fact.md"), "---\nname: fact\n---\nnew fact\n");

    await prepareProjectMemoryScope(scope);
    await prepareProjectMemoryScope(scope);
    const index = await readFile(join(scope.root, "MEMORY.md"), "utf8");
    assert.equal(index.split("\n").filter((line) => line.includes("legacy-")).length, 1);
    assert.match(index, /\[New\]\(fact\.md\)/);
    assert.match(index, /# Project memory/);
    const renamed = /\]\((fact-legacy-[^)]*\.md)\)/.exec(index)?.[1];
    assert.ok(renamed);
    assert.match(
      await readFile(join(scope.root, renamed), "utf8"),
      new RegExp(`name: ${renamed.slice(0, -3)}`),
    );
    assert.match(await readFile(join(scope.legacyRoot, ".migrated-to"), "utf8"), /memory/);
    const metadata = JSON.parse(await readFile(join(scope.root, ".project.json"), "utf8"));
    assert.equal(metadata.displayPath, await realpath(workspacePath));
    await rm(join(scope.root, "MEMORY.md"));
    await prepareProjectMemoryScope(scope);
    const restored = await readFile(join(scope.root, "MEMORY.md"), "utf8");
    assert.match(restored, /\]\(fact\.md\)/);
    assert.match(restored, /legacy-/);
    await writeFile(
      join(scope.legacyRoot, "new-from-old.md"),
      "---\nname: new-from-old\n---\nlegacy client write\n",
    );
    await writeFile(
      join(scope.legacyRoot, "MEMORY.md"),
      "# Project memory\n- [Old](fact.md) — old\n- [Later](new-from-old.md) — later\n",
    );
    await prepareProjectMemoryScope(scope);
    const later = await readFile(join(scope.root, "MEMORY.md"), "utf8");
    assert.match(later, /\[Later\]\(new-from-old\.md\)/);
    await prepareProjectMemoryScope(scope);
    assert.equal(
      (await readFile(join(scope.root, "MEMORY.md"), "utf8"))
        .split("\n")
        .filter((line) => line.includes("new-from-old.md")).length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
