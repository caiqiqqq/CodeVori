import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveOfficialPluginRoots } from "../src/app/bundled-plugins.js";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

test("computer control seed includes independent MCP, verified native addon and notices without broker authority", { skip: !["darwin", "win32"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-open-cua-seed-"));
  const original = process.env.ZCODE_OPEN_CUA_NATIVE;
  try {
    process.env.ZCODE_OPEN_CUA_NATIVE = process.execPath;
    resolveOfficialPluginRoots({ storageRoot: root });
    const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((item) => item.name === "computer-use")!;
    const cached = join(root, "cache", "zcode-plugins-official", "computer-use", definition.version);
    for (const path of definition.requiredSeedPaths!) await access(join(cached, path));
    if (!(process.platform === "darwin" && process.arch === "x64")) {
      const runtime = JSON.parse(await readFile(join(cached, "dist/native/runtime.json"), "utf8"));
      assert.equal(runtime.platform, process.platform);
      assert.equal(runtime.arch, process.arch);
    }
    const manifest = JSON.parse(await readFile(join(cached, ".zcode-plugin/plugin.json"), "utf8"));
    // 原生修复必须跟随缓存版本一起更新，不能让新执行器继续占用旧版本目录。
    assert.equal(manifest.version, definition.version);
    assert.equal(manifest.mcpServers["computer-use"].command, process.execPath);
    assert.equal(manifest.mcpServers["computer-use"].env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(manifest.mcpServers["computer-use"].env.ZCODE_CUA_PLUGIN_AUTHORITY, undefined);
    assert.equal(definition.defaultEnabled, undefined);
    assert.equal(definition.hostMcpServerNames, undefined);
    delete process.env.ZCODE_OPEN_CUA_NATIVE;
    const remoteRoot = join(root, "remote");
    resolveOfficialPluginRoots({ storageRoot: remoteRoot });
    await assert.rejects(access(join(remoteRoot, "cache/zcode-plugins-official/computer-use")), { code: "ENOENT" });
  } finally {
    if (original === undefined) delete process.env.ZCODE_OPEN_CUA_NATIVE; else process.env.ZCODE_OPEN_CUA_NATIVE = original;
    await rm(root, { recursive: true, force: true });
  }
});
