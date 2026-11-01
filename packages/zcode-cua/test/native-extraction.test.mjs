import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { extractNativeAsset } from "../scripts/extract-native-asset.mjs";

test("Windows native import bypasses Git Bash tar and its drive-letter parsing", async () => {
  let invocation;
  await extractNativeAsset(
    "C:\\Users\\Runner Name\\Temp\\official.exe",
    "resources/tools/cua-helper/build/Release/ax_native.node",
    {
      platform: "win32",
      systemRoot: "C:\\Windows",
      execute: async (...args) => {
        invocation = args;
      },
    },
  );
  assert.equal(invocation[0], "C:\\Windows\\System32\\tar.exe");
  assert.deepEqual(invocation[1], [
    "-xf",
    "official.exe",
    "resources/tools/cua-helper/build/Release/ax_native.node",
  ]);
  assert.equal(invocation[2].cwd, "C:\\Users\\Runner Name\\Temp");
});

test("native importer extracts the selected member from a directory containing spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native import test "));
  const member = "resources/native/ax_native.node";
  const execute = promisify(execFile);
  const tar =
    process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
  try {
    await mkdir(join(directory, "resources/native"), { recursive: true });
    await writeFile(join(directory, member), "native fixture");
    await execute(tar, ["-cf", "official.tar", member], { cwd: directory });
    await rm(join(directory, "resources"), { recursive: true });
    await extractNativeAsset(join(directory, "official.tar"), member);
    assert.equal(await readFile(join(directory, member), "utf8"), "native fixture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
