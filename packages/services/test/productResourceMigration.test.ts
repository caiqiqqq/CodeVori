import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createCommandsService } from "../src/commands/commandsService.js";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";
import { createHooksService } from "../src/hooks/hooksService.js";
import { createSkillsService } from "../src/skills/skillsService.js";

test("commands, skills, MCP and Hooks load migrated project files and only update CodeVori paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-resource-services-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const previous = process.env.HOME;
  process.env.HOME = home;
  const put = async (path: string, content: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  const userConfig =
    '{"mcp":{"servers":{"user-server":{"type":"stdio","command":"node","args":["user.js"]}}}}';
  const projectConfig = JSON.stringify({
    mcp: {
      servers: { "project-server": { type: "stdio", command: "node", args: ["project.js"] } },
    },
    hooks: {
      enabled: true,
      events: { SessionStart: [{ hooks: [{ type: "command", command: "echo migration-test" }] }] },
    },
  });
  try {
    await put(join(home, ".zcode/cli/config.json"), userConfig);
    await put(
      join(home, ".zcode/commands/user.md"),
      "---\ndescription: user command\n---\nold user prompt\n",
    );
    await put(join(workspace, ".zcode/config.json"), projectConfig);
    await put(
      join(workspace, ".zcode/commands/project.md"),
      "---\ndescription: project command\n---\nold project prompt\n",
    );
    await put(
      join(workspace, ".zcode/skills/example/SKILL.md"),
      "---\nname: example\ndescription: migration test skill\n---\nDo useful work.\n",
    );
    const commands = createCommandsService();
    const listed = await commands.list({ workspacePath: workspace });
    assert.ok(
      listed.userCommands.some(
        (command) => command.filePath === join(home, ".codevori/commands/user.md"),
      ),
    );
    assert.ok(
      listed.userCommands.some(
        (command) => command.filePath === join(workspace, ".codevori/commands/project.md"),
      ),
    );
    await commands.deleteCommandFile({
      filePath: join(workspace, ".codevori/commands/project.md"),
    });
    assert.match(
      await readFile(join(workspace, ".zcode/commands/project.md"), "utf8"),
      /old project prompt/,
    );
    const skills = await createSkillsService().list({ workspacePath: workspace });
    assert.ok(
      skills.skills.some(
        (skill) => skill.name === "example" && skill.path.includes("/.codevori/skills/example/"),
      ),
    );
    const mcp = createMcpSyncService();
    const servers = await mcp.loadMcpFromUserDirectory({ workspacePath: workspace });
    assert.ok(servers.servers.some((server) => server.name === "user-server"));
    assert.ok(servers.servers.some((server) => server.name === "project-server"));
    assert.ok(servers.servers.every((server) => server.file?.filePath.includes(".codevori")));
    const hooksService = createHooksService();
    const hooks = await hooksService.loadHooks({ workspacePath: workspace });
    assert.ok(hooks.hooks.length > 0);
    assert.ok(
      hooks.workspaceHookSnapshot?.sourceFiles.every((source) =>
        source.canonicalPath.includes(".codevori"),
      ),
    );
    await hooksService.saveHooks({ workspacePath: workspace, hooks: hooks.hooks });
    assert.equal(await readFile(join(workspace, ".zcode/config.json"), "utf8"), projectConfig);
    assert.equal(await readFile(join(home, ".zcode/cli/config.json"), "utf8"), userConfig);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
