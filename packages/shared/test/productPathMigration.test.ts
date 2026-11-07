import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { prepareProductPaths } from "../src/node/productPathMigration.js";

// 产品规则：旧目录仅作为一次性复制来源；新目录优先，完成后删除的文件不得被重新导入。
test("path migration isolates commands, workflows and project resources without overwriting current files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-path-migration-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const put = async (path: string, value: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
  };
  try {
    await put(join(home, ".zcode/commands/old.md"), "old command");
    await put(join(home, ".zcode/workflows/test.dwf.ts"), "workflow");
    await put(join(home, ".zcode/cli/plugins/installed_plugins.json"), '{"plugins":{}}');
    await put(join(home, ".zcode/plans/example.md"), "plan");
    await put(join(home, ".codevori/commands/old.md"), "current command");
    await put(join(home, ".codevori/.migration-from-zcode.json"), '{"status":"complete"}');
    await put(join(project, ".git/HEAD"), "ref: refs/heads/main");
    await put(join(project, ".zcode/skills/example/SKILL.md"), "skill");
    await put(join(project, ".zcode/agents/a.md"), "agent");
    await put(join(project, ".zcode/plans/plan.md"), "plan");
    await put(join(project, ".zcode/agent-memory/a/MEMORY.md"), "memory");
    await put(
      join(project, ".zcode/config.json"),
      JSON.stringify({ plugins: { dirs: [join(project, ".zcode/plugins/p")] } }),
    );
    await put(join(project, "zcode.json"), '{"mcp":{"servers":{}}}');
    await put(join(project, ".zcodeignore"), "*.private\n");
    await mkdir(join(project, "src"));
    await Promise.all(
      Array.from({ length: 8 }, () =>
        prepareProductPaths({ homeDirectory: home, workspacePath: join(project, "src") }),
      ),
    );
    assert.equal(
      await readFile(join(home, ".codevori/commands/old.md"), "utf8"),
      "current command",
    );
    assert.equal(await readFile(join(home, ".codevori/workflows/test.dwf.ts"), "utf8"), "workflow");
    assert.equal(
      await readFile(join(home, ".codevori/cli/plugins/installed_plugins.json"), "utf8"),
      '{"plugins":{}}',
    );
    assert.equal(await readFile(join(home, ".codevori/plans/example.md"), "utf8"), "plan");
    for (const path of [
      "skills/example/SKILL.md",
      "agents/a.md",
      "plans/plan.md",
      "agent-memory/a/MEMORY.md",
    ]) {
      assert.equal(
        await readFile(join(project, ".codevori", path), "utf8"),
        await readFile(join(project, ".zcode", path), "utf8"),
      );
    }
    assert.equal(await readFile(join(project, ".codevoriignore"), "utf8"), "*.private\n");
    assert.equal(await readFile(join(project, "codevori.json"), "utf8"), '{"mcp":{"servers":{}}}');
    assert.deepEqual(
      JSON.parse(await readFile(join(project, ".codevori/config.json"), "utf8")).plugins.dirs,
      [join(project, ".codevori/plugins/p")],
    );
    await unlink(join(home, ".codevori/workflows/test.dwf.ts"));
    await put(join(project, ".zcode/agents/later.md"), "old app later write");
    await prepareProductPaths({ homeDirectory: home, workspacePath: project });
    await assert.rejects(readFile(join(home, ".codevori/workflows/test.dwf.ts")), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(project, ".codevori/agents/later.md")), { code: "ENOENT" });
    assert.equal(await readFile(join(home, ".zcode/commands/old.md"), "utf8"), "old command");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an interrupted copy repairs legacy target symlinks without writing into the old product", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-path-retry-"));
  const project = join(root, "project");
  try {
    await mkdir(join(project, ".zcode/commands"), { recursive: true });
    await writeFile(join(project, ".zcode/commands/a.md"), "original");
    await mkdir(join(project, ".codevori"));
    await symlink(join(project, ".zcode/commands"), join(project, ".codevori/commands"), "dir");
    await prepareProductPaths({ homeDirectory: root, workspacePath: project });
    assert.equal(await readFile(join(project, ".zcode/commands/a.md"), "utf8"), "original");
    assert.equal(await readFile(join(project, ".codevori/commands/a.md"), "utf8"), "original");
    await writeFile(join(project, ".codevori/commands/a.md"), "new app edit");
    assert.equal(await readFile(join(project, ".zcode/commands/a.md"), "utf8"), "original");
    await symlink("commands", join(project, ".zcode/linked-commands"), "dir");
    await unlink(join(project, ".codevori/.product-path-migration-v2.json"));
    await prepareProductPaths({ homeDirectory: root, workspacePath: project });
    assert.equal(await readFile(join(project, ".codevori/commands/a.md"), "utf8"), "new app edit");
    assert.equal(
      await readlink(join(project, ".codevori/linked-commands")),
      join(project, ".codevori/commands"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration rejects a target symlink to an unrelated location", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-path-link-"));
  const project = join(root, "project");
  try {
    await mkdir(join(project, ".zcode/commands"), { recursive: true });
    await mkdir(join(project, ".codevori"));
    await mkdir(join(root, "external"));
    await writeFile(join(project, ".zcode/commands/a.md"), "old");
    await symlink(join(root, "external"), join(project, ".codevori/commands"), "dir");
    await assert.rejects(
      prepareProductPaths({ homeDirectory: root, workspacePath: project }),
      /symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration preserves malformed legacy config for the configuration service", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-path-corrupt-"));
  try {
    await mkdir(join(root, ".zcode/cli"), { recursive: true });
    await writeFile(join(root, ".zcode/cli/config.json"), '{"broken":');
    await prepareProductPaths({ homeDirectory: root });
    assert.equal(await readFile(join(root, ".codevori/cli/config.json"), "utf8"), '{"broken":');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
