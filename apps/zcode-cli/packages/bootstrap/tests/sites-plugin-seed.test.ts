import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveOfficialPluginRoots } from "../src/app/bundled-plugins.js";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

test("Sites default plugin seeds executable CLI, MCP server, panel and deployment skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-sites-seed-"));
  try {
    const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((item) => item.name === "zcode-site")!;
    assert.equal(definition.defaultEnabled, true);
    resolveOfficialPluginRoots({ storageRoot: root });
    const cached = join(root, "cache/zcode-plugins-official/zcode-site", definition.version);
    for (const path of definition.requiredSeedPaths!) await access(join(cached, path));
    const manifest = JSON.parse(await readFile(join(cached, ".zcode-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.version, definition.version);
    assert.ok(JSON.stringify(manifest).includes("dist/server.mjs"));
    const panel = await readFile(join(cached, "dist/ui/panel.html"), "utf8");
    assert.ok(panel.includes("<script"));
    assert.equal(panel.includes("node_modules/"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
