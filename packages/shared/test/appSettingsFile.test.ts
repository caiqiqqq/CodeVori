import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveAppSettingsPaths } from "../src/node.js";

test("settings path belongs only to the CodeVori home", () => {
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  const previousDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = join(tmpdir(), "isolated-product-home");
  process.env.ZCODE_DATA_BASE_DIR = join(tmpdir(), "separate-business-data");
  try {
    assert.deepEqual(resolveAppSettingsPaths(), {
      settingsFile: join(tmpdir(), "isolated-product-home/.codevori/v2/setting.json"),
    });
    assert.deepEqual(resolveAppSettingsPaths(join(tmpdir(), "explicit-home")), {
      settingsFile: join(tmpdir(), "explicit-home/.codevori/v2/setting.json"),
    });
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    if (previousDataBaseDir === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = previousDataBaseDir;
  }
});
