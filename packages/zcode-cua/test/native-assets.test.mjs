import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verifyNativeAsset, NATIVE_ASSETS } from "../native-assets.mjs";
import { resolveOpenComputerUseNative } from "../open-native.mjs";
import { NATIVE_TOOLS } from "../native-tools.mjs";
import { TOOL_FIELDS } from "../runtime-contract.mjs";

test("native importer rejects arbitrary bytes and unsupported targets before load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codevori-cua-integrity-"));
  const addon = join(dir, "ax_native.node");
  try {
    await writeFile(addon, "not an official native addon");
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["win32", "x64"],
      ["win32", "arm64"],
    ]) {
      await assert.rejects(verifyNativeAsset(addon, { platform, arch }), /integrity mismatch/);
    }
    await assert.rejects(
      verifyNativeAsset(addon, { platform: "linux", arch: "x64" }),
      /No verified/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every native asset is pinned to one release and exact platform; Intel compatibility has its own path", () => {
  assert.deepEqual(Object.keys(NATIVE_ASSETS).sort(), ["darwin-arm64", "win32-arm64", "win32-x64"]);
  for (const asset of Object.values(NATIVE_ASSETS)) {
    assert.equal(asset.version, "3.17.2");
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(Buffer.from(asset.archiveSha512, "base64").length, 64);
    assert.ok(asset.url.startsWith("https://cdn-zcode.z.ai/"));
  }
  // 原因：CDN 目录与安装包文件名的平台名不同，不能从文件名推导下载目录。
  assert.equal(
    new URL(NATIVE_ASSETS["darwin-arm64"].url).pathname,
    "/zcode/electron/releases/3.17.2/macos-arm64/ZCode-3.17.2-mac-arm64.zip",
  );
  assert.ok(
    resolveOpenComputerUseNative({ env: {}, platform: "darwin", arch: "x64" }).endsWith(
      "darwin-x64/OpenZCodeNative",
    ),
  );
});

test("MCP advertises exactly the shared-host methods and omits physical pointer takeover", () => {
  assert.deepEqual(
    NATIVE_TOOLS.map((tool) => tool.name),
    [...TOOL_FIELDS.keys()],
  );
  assert.equal(NATIVE_TOOLS.length, 14);
  assert.equal(
    NATIVE_TOOLS.some((tool) =>
      ["mouse_move", "left_mouse_down", "left_mouse_up", "open_application"].includes(tool.name),
    ),
    false,
  );
});

test("bundled native manifest detects modified helper before launch", async (t) => {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    return t.skip("Local imported addon is optional in source-only CI");
  const source = resolveOpenComputerUseNative({ env: {} });
  let bytes;
  try {
    bytes = await readFile(source);
  } catch {
    return t.skip("Run build:native for a live imported asset check");
  }
  const dir = await mkdtemp(join(tmpdir(), "codevori-cua-manifest-"));
  try {
    await writeFile(join(dir, "ax_native.node"), bytes);
    await writeFile(
      join(dir, "runtime.json"),
      JSON.stringify({
        platform: "darwin",
        arch: "arm64",
        version: "3.17.2",
        sha256: NATIVE_ASSETS["darwin-arm64"].sha256,
        helperSha256: "0".repeat(64),
      }),
    );
    await writeFile(join(dir, "helper.mjs"), "throw new Error('tampered')");
    await assert.rejects(
      verifyNativeAsset(join(dir, "ax_native.node")),
      /helper integrity mismatch/,
    );
    for (const name of ["helper.mjs", "runtime.json"])
      await copyFile(join(dirname(source), name), join(dir, name));
    await writeFile(join(dir, "cocoa-runloop.node"), "modified bridge");
    await assert.rejects(
      verifyNativeAsset(join(dir, "ax_native.node")),
      /Cocoa bridge integrity mismatch/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
