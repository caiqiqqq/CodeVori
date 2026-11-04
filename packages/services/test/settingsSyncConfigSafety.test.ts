import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SettingsSyncCategory } from "@zcode/shared";
import { updateJsonObjectFile } from "../src/fs/atomicFileUtils.js";
import { createSettingsSyncService } from "../src/settings-sync/settingsSyncService.js";
import type { ISettingService } from "../src/setting/setting.js";

async function fixture(category: "mcpServers" | "plugins") {
  const home = await mkdtemp(join(tmpdir(), "zcode-settings-sync-safety-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const configPath = join(home, ".zcode", "cli", "config.json");
  await mkdir(join(home, ".zcode", "cli"), { recursive: true });
  const pluginTarget = join(home, ".zcode", "plugins", "example");
  if (category === "mcpServers") {
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { example: { command: "node", args: ["example.mjs"] } } }),
    );
  } else {
    const manifestDir = join(home, ".claude", "plugins", "example", ".claude-plugin");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(join(manifestDir, "plugin.json"), JSON.stringify({ name: "example" }));
  }
  const service = createSettingsSyncService({ settingService: {} as ISettingService });
  return {
    configPath,
    pluginTarget,
    async import() {
      const discovered = await service.detect({ categories: [category], intent: "manualImport" });
      assert.equal(discovered.agents[0]?.categories[0]?.discoveredCount, 1);
      return service.importSelected({
        selections: [
          {
            agent: "claudeCode",
            category,
            sourceScope: "global",
            targetScope: "global",
            importMode: "copy",
          },
        ],
      });
    },
    async dispose() {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    },
  };
}

for (const category of ["mcpServers", "plugins"] satisfies SettingsSyncCategory[]) {
  test(`${category} import preserves corrupt config and reports failure`, async () => {
    const f = await fixture(category);
    try {
      const corrupt = '{"commands":{"dirs":["keep"]},';
      await writeFile(f.configPath, corrupt);
      const result = await f.import();
      assert.equal(result.successCount, 0);
      assert.equal(result.failedCount, 1);
      assert.equal(await readFile(f.configPath, "utf8"), corrupt);
      if (category === "plugins") await assert.rejects(lstat(f.pluginTarget), { code: "ENOENT" });
    } finally {
      await f.dispose();
    }
  });

  test(`${category} import preserves unrelated config fields`, async () => {
    const f = await fixture(category);
    try {
      const original = {
        commands: { dirs: ["keep"] },
        skills: { dirs: ["also-keep"] },
        hooks: { enabled: true },
      };
      await writeFile(f.configPath, JSON.stringify(original));
      const result = await f.import();
      assert.equal(result.successCount, 1);
      assert.equal(result.failedCount, 0);
      const saved = JSON.parse(await readFile(f.configPath, "utf8"));
      assert.deepEqual(saved.commands, original.commands);
      assert.deepEqual(saved.skills, original.skills);
      assert.deepEqual(saved.hooks, original.hooks);
      if (category === "mcpServers") assert.equal(saved.mcp.servers.example.command, "node");
      else assert.deepEqual(saved.plugins.dirs, [f.pluginTarget]);
    } finally {
      await f.dispose();
    }
  });
}

test("MCP and plugin imports reject non-object roots and plugin import can retry after repair", async () => {
  for (const category of ["mcpServers", "plugins"] as const) {
    const f = await fixture(category);
    try {
      for (const raw of ["[]", "null", '"value"']) {
        await writeFile(f.configPath, raw);
        assert.equal((await f.import()).failedCount, 1);
        assert.equal(await readFile(f.configPath, "utf8"), raw);
      }
      await writeFile(f.configPath, "{}");
      assert.equal((await f.import()).successCount, 1);
    } finally {
      await f.dispose();
    }
  }
});

test("command, skill and hook save entrypoints preserve malformed user configuration", async () => {
  const f = await fixture("mcpServers");
  try {
    const { createCommandsService } = await import("../src/commands/commandsService.js");
    const { createSkillsService } = await import("../src/skills/skillsService.js");
    const { createHooksService } = await import("../src/hooks/hooksService.js");
    const workspace = join(f.configPath, "..", "..", "..", "workspace");
    await mkdir(join(workspace, ".zcode", "skills", "fixture"), { recursive: true });
    await writeFile(
      join(workspace, ".zcode", "skills", "fixture", "SKILL.md"),
      "---\nname: fixture\ndescription: fixture\n---\nfixture",
    );
    const skills = createSkillsService({ isDesktopRuntime: true });
    const listed = await skills.list({ workspacePath: workspace });
    assert.ok(listed.skills[0]);
    const corrupt = '{"keep":';
    await writeFile(f.configPath, corrupt);
    await assert.rejects(
      createCommandsService().setCommandEnabled({
        filePath: join(workspace, "fixture.md"),
        enabled: false,
      }),
    );
    await assert.rejects(
      skills.setEnabled({ workspacePath: workspace, skillId: listed.skills[0].id, enabled: false }),
    );
    await assert.rejects(createHooksService().saveHooks({ workspacePath: workspace, hooks: [] }));
    assert.equal(await readFile(f.configPath, "utf8"), corrupt);
  } finally {
    await f.dispose();
  }
});

test("concurrent config updates preserve every writer's field", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-config-concurrent-"));
  const filePath = join(directory, "config.json");
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        updateJsonObjectFile(filePath, (current) => ({ ...current, [`entry${index}`]: index })),
      ),
    );
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, number>;
    for (let index = 0; index < 12; index += 1) {
      assert.equal(parsed[`entry${index}`], index);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
