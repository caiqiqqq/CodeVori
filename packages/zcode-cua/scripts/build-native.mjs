import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { build } from "esbuild";
import { getTargetPlatform } from "../../desktop/scripts/target-platform.mjs";
import { NATIVE_ASSETS, verifyNativeAsset } from "../native-assets.mjs";
import { buildCocoaRunLoop } from "./build-cocoa-runloop.mjs";
import { extractNativeAsset } from "./extract-native-asset.mjs";

const root = resolve(import.meta.dirname, "..");
const target = getTargetPlatform();
if (!["darwin", "win32"].includes(target.os)) {
  console.log(`[computer-use] no native runtime for ${target.key}`);
  process.exit(0);
}
// 官方当前发行包未提供可验证的 Intel addon；保留既有 Intel 能力，避免破坏已支持的发布矩阵。
if (target.os === "darwin" && target.arch === "x64") {
  await promisify(execFile)(
    process.execPath,
    [join(root, "scripts/build-legacy-intel-native.mjs")],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  console.log("[computer-use] prepared existing Intel macOS compatibility executor");
  process.exit(0);
}
const asset = NATIVE_ASSETS[target.key];
if (!asset)
  throw new Error(
    `No verified official native asset for ${target.key}. Refusing to package a different architecture.`,
  );
const directory = join(root, "native-bin", target.key);
await mkdir(directory, { recursive: true });
let source = process.env.ZCODE_CUA_NATIVE_SOURCE?.trim();
const addon = join(directory, "ax_native.node");
if (!source) {
  try {
    await verifyNativeAsset(addon, {
      platform: target.os,
      arch: target.arch,
      requireManifest: false,
    });
    source = addon;
  } catch {
    /* Download the pinned release instead of accepting a stale native. */
  }
}
let temporary;
try {
  if (!source) {
    temporary = await mkdtemp(join(tmpdir(), "codevori-cua-import-"));
    const archive = join(temporary, target.os === "win32" ? "official.exe" : "official.zip");
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok)
      throw new Error(
        `Official native download failed (${response.status}). Set ZCODE_CUA_NATIVE_SOURCE to an extracted official ${asset.version} addon.`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha512").update(bytes).digest("base64") !== asset.archiveSha512)
      throw new Error("Official installer SHA512 mismatch.");
    await writeFile(archive, bytes);
    await extractNativeAsset(archive, asset.member);
    source = join(temporary, asset.member);
  }
  await verifyNativeAsset(source, {
    platform: target.os,
    arch: target.arch,
    requireManifest: false,
  });
  if (resolve(source) !== addon) {
    const pending = `${addon}.pending`;
    await copyFile(source, pending);
    await rename(pending, addon);
  }
  await build({
    entryPoints: [join(root, "native-helper.mjs")],
    outfile: join(directory, "helper.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
  });
  await access(addon);
  const helperSha256 = createHash("sha256")
    .update(await readFile(join(directory, "helper.mjs")))
    .digest("hex");
  let cocoaRunLoopSha256;
  if (target.os === "darwin") {
    await buildCocoaRunLoop(directory);
    cocoaRunLoopSha256 = createHash("sha256")
      .update(await readFile(join(directory, "cocoa-runloop.node")))
      .digest("hex");
  }
  await writeFile(
    join(directory, "runtime.json"),
    `${JSON.stringify({ version: asset.version, platform: target.os, arch: target.arch, sha256: asset.sha256, helperSha256, cocoaRunLoopSha256, source: asset.url, notice: "Native addon from the proprietary ZCode distribution; not covered by CodeVori source license. Redistribution requires the original rightsholder's permission." }, null, 2)}\n`,
  );
  console.log(
    `[computer-use] verified official ${asset.version} addon and prepared helper for ${target.key}`,
  );
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
