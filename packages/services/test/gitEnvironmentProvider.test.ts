import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import test from "node:test";
import { createGitEnvironmentProvider } from "../src/git/providers/gitEnvironmentProvider.js";

test(
  "Git discovery resolves PATH order, spaces and overrides to absolute paths and caches once",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "zcode-git-discovery-"));
    const originalPath = process.env.PATH;
    const originalOverride = process.env.ZCODE_GIT_BINARY;
    t.after(async () => {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalOverride === undefined) delete process.env.ZCODE_GIT_BINARY;
      else process.env.ZCODE_GIT_BINARY = originalOverride;
      await rm(root, { recursive: true, force: true });
    });
    const directory = join(root, "directory");
    const blocked = join(root, "non-executable");
    const first = join(root, "first path with spaces");
    const second = join(root, "second");
    for (const folder of [directory, blocked, first, second]) await mkdir(folder);
    await mkdir(join(directory, "git"));
    for (const folder of [blocked, first, second]) {
      const file = join(folder, "git");
      await writeFile(file, "#!/bin/sh\nprintf 'git version 2.99.0\\n'\n");
      await chmod(file, folder === blocked ? 0o644 : 0o755);
    }
    delete process.env.ZCODE_GIT_BINARY;
    process.env.PATH = [directory, blocked, first, second].join(delimiter);
    const provider = createGitEnvironmentProvider();
    assert.equal(await provider.resolveGitBinary(), join(first, "git"));
    process.env.PATH = second;
    assert.equal(await provider.resolveGitBinary(), join(first, "git"));
    assert.equal(await createGitEnvironmentProvider().resolveGitBinary(), join(second, "git"));
    process.env.ZCODE_GIT_BINARY = relative(process.cwd(), join(first, "git"));
    assert.equal(await createGitEnvironmentProvider().resolveGitBinary(), join(first, "git"));
    process.env.ZCODE_GIT_BINARY = join(root, "missing-git");
    assert.equal(await createGitEnvironmentProvider().resolveGitBinary(), join(second, "git"));
    process.env.PATH = root;
    assert.equal(await createGitEnvironmentProvider().resolveGitBinary(), null);
  },
);
