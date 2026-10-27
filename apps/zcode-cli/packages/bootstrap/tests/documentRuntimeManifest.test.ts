import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeOfficialPluginRuntimeManifest } from "../src/app/official-plugin-runtime.ts";

test("official document entrypoint and workspace sharing survive runtime manifest rewrite", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "zcode-document-manifest-"));
  const path = join(rootPath, ".zcode-plugin", "plugin.json");
  try {
    await mkdir(join(rootPath, ".zcode-plugin"));
    await writeFile(path, JSON.stringify({ mcpServers: { documents: { type: "stdio", command: "node", args: ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"], isolation: "workspace" } } }));
    writeOfficialPluginRuntimeManifest({ rootPath, pluginName: "documents" });
    let server = JSON.parse(await readFile(path, "utf8")).mcpServers.documents;
    assert.equal(server.args.at(-1), join(rootPath, "dist/server.mjs"));
    assert.equal(server.isolation, "workspace");
    const first = await readFile(path, "utf8");
    writeOfficialPluginRuntimeManifest({ rootPath, pluginName: "documents" });
    assert.equal(await readFile(path, "utf8"), first);
    await writeFile(path, JSON.stringify({ mcpServers: { documents: { type: "stdio", args: ["${ZCODE_PLUGIN_ROOT}/../outside.mjs"] } } }));
    assert.throws(() => writeOfficialPluginRuntimeManifest({ rootPath, pluginName: "documents" }), /outside|escapes/i);
  } finally { await rm(rootPath, { recursive: true, force: true }); }
});
