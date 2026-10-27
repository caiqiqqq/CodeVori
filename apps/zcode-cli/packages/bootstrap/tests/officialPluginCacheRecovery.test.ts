import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveOfficialPluginRoots } from "../src/app/bundled-plugins.ts";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.ts";

test("official cache repairs deleted required assets and damaged manifests; complete caches stay untouched", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "zcode-seed-recovery-"));
  const cwd = process.cwd();
  const entry = process.argv[1];
  t.after(async () => { process.chdir(cwd); process.argv[1] = entry; await rm(scratch, { recursive: true, force: true }); });
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((item) => item.name === "browser-use")!;
  const source = join(scratch, "packages/browser-use-plugin");
  const manifest = join(source, ".zcode-plugin/plugin.json");
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(manifest, JSON.stringify({ name: definition.name, version: definition.version }));
  for (const path of definition.requiredSeedPaths ?? []) {
    const file = join(source, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "original\n");
  }
  process.chdir(scratch);
  process.argv[1] = join(scratch, "entry.mjs");
  const storageRoot = join(scratch, "storage");
  const seed = () => resolveOfficialPluginRoots({ storageRoot });
  seed();
  const marketplace = (await readdir(join(storageRoot, "cache")))[0]!;
  const target = join(storageRoot, "cache", marketplace, definition.name, definition.version);
  const required = join(target, "docs/overview.md");
  await writeFile(join(target, "sentinel"), "keep");
  seed();
  assert.equal(fs.existsSync(join(target, "sentinel")), true);
  await rm(required);
  seed();
  assert.equal(await readFile(required, "utf8"), "original\n");
  await writeFile(join(target, ".zcode-plugin/plugin.json"), "invalid-json");
  seed();
  assert.equal(JSON.parse(await readFile(join(target, ".zcode-plugin/plugin.json"), "utf8")).name, definition.name);

  await t.test("overlayfs EXDEV while replacing an old lower-layer cache rebuilds the version", async () => {
    await writeFile(join(source, "docs/overview.md"), "updated\n");
    const rename = fs.renameSync;
    const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === target) throw Object.assign(new Error("synthetic overlayfs lower directory"), { code: "EXDEV" });
      return rename(from, to);
    });
    syncBuiltinESMExports();
    try {
      seed();
      assert.equal(await readFile(required, "utf8"), "updated\n");
      assert.equal(fs.existsSync(join(target, ".zcode-plugin-seed.json")), true);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
});
