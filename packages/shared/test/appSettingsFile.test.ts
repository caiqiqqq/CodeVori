import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { prepareAppSettingsFile, resolveAppSettingsPaths } from "../src/node.js";

test("concurrent migration preserves raw content and never reimports changed legacy settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "codevori-settings-migration-"));
  try {
    const { settingsFile, legacySettingsFile } = resolveAppSettingsPaths(home);
    assert.equal(settingsFile, join(home, ".codevori/v2/setting.json"));
    const raw =
      '{\n "quickMessages": [{"id":"saved","title":"检查","content":"正文  "}],\n "futureField": {"keep":true}\n}\n';
    await mkdir(dirname(legacySettingsFile), { recursive: true });
    await writeFile(legacySettingsFile, raw);
    const migrated = await Promise.all(
      Array.from({ length: 16 }, () => prepareAppSettingsFile(home)),
    );
    assert.ok(migrated.every((file) => file === settingsFile));
    assert.equal(await readFile(settingsFile, "utf8"), raw);
    assert.equal(await readFile(legacySettingsFile, "utf8"), raw);
    if (process.platform !== "win32") assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);
    await writeFile(settingsFile, '{"quickMessages":[]}');
    await writeFile(legacySettingsFile, '{"quickMessages":[{"id":"other"}]}');
    await prepareAppSettingsFile(home);
    assert.equal(await readFile(settingsFile, "utf8"), '{"quickMessages":[]}');
    await writeFile(settingsFile, "invalid current JSON");
    await prepareAppSettingsFile(home);
    assert.equal(await readFile(settingsFile, "utf8"), "invalid current JSON");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("invalid legacy settings remain intact and do not create a migrated file", async () => {
  const home = await mkdtemp(join(tmpdir(), "codevori-settings-invalid-"));
  try {
    const { settingsFile, legacySettingsFile } = resolveAppSettingsPaths(home);
    await mkdir(dirname(legacySettingsFile), { recursive: true });
    for (const raw of ["broken JSON", "null", "[]"]) {
      await writeFile(legacySettingsFile, raw);
      await assert.rejects(prepareAppSettingsFile(home));
      assert.equal(await readFile(legacySettingsFile, "utf8"), raw);
      await assert.rejects(readFile(settingsFile), { code: "ENOENT" });
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an isolated desktop home owns settings even when HOME and dataBaseDir differ", () => {
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  const previousDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = join(tmpdir(), "isolated-product-home");
  process.env.ZCODE_DATA_BASE_DIR = join(tmpdir(), "separate-business-data");
  try {
    assert.equal(
      resolveAppSettingsPaths().settingsFile,
      join(tmpdir(), "isolated-product-home/.codevori/v2/setting.json"),
    );
    assert.equal(
      resolveAppSettingsPaths(join(tmpdir(), "explicit-home")).settingsFile,
      join(tmpdir(), "explicit-home/.codevori/v2/setting.json"),
    );
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    if (previousDataBaseDir === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = previousDataBaseDir;
  }
});
