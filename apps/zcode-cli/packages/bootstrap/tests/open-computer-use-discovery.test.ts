import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverNodePluginsSync } from "@zcode/adapters/plugins";
import type { PluginConfig } from "@zcode/contracts";

test("desktop control discovery rejects enabled stale cache on remote Hosts and disabled feature", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-open-cua-discovery-"));
  const id = "computer-use@zcode-plugins-official";
  const pluginRoot = join(root, "cached-computer-use");
  const config: PluginConfig = {
    dirs: [],
    enabled: true,
    enabledPlugins: { [id]: true },
    extraKnownMarketplaces: {},
    options: {},
    suppressedBuiltins: [],
  };
  try {
    await mkdir(join(pluginRoot, ".zcode-plugin"), { recursive: true });
    await mkdir(join(pluginRoot, "skills/control"), { recursive: true });
    await writeFile(join(pluginRoot, ".zcode-plugin/plugin.json"), JSON.stringify({
      name: "computer-use",
      version: "0.6.4",
      mcpServers: { "computer-use": { command: process.execPath, args: ["server.js"] } },
    }));
    await writeFile(join(pluginRoot, "skills/control/SKILL.md"), "---\nname: control\ndescription: Control the computer\n---\nControl the computer.\n");
    const discover = (env: Record<string, string>) => discoverNodePluginsSync({
      config, env, officialPluginRoots: [pluginRoot], storageRoot: root, workingDirectory: root,
    });
    for (const env of [
      {},
      { ZCODE_OPEN_CUA_NATIVE: " " },
      { ZCODE_OPEN_CUA_NATIVE: "/application/native", ZCODE_CUA_PRODUCT_HELPER: "0" },
    ]) {
      const result = discover(env);
      assert.deepEqual(result.plugins, []);
      assert.deepEqual(result.skillRoots, []);
      assert.deepEqual(result.commandRoots, []);
      assert.deepEqual(result.mcpServers, {});
    }
    const local = discover({ ZCODE_OPEN_CUA_NATIVE: "/application/native" });
    assert.equal(local.plugins.some(plugin => plugin.id === id), process.platform === "darwin");
    assert.equal(Object.keys(local.mcpServers).length, process.platform === "darwin" ? 1 : 0);
    assert.equal(config.enabledPlugins[id], true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
