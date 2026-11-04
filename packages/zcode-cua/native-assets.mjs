import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// 原因：公开 producer 是占位包；只能从已核对的正式发行物导入，不能把任意 .node 当作官方组件。
export const NATIVE_ASSETS = Object.freeze({
  "darwin-arm64": {
    version: "3.17.2",
    sha256: "b169b8dc8be0dc747fdba5d8e17d4c814e13068b711a238d421b808c660ceaea",
    // 原因：官方下载目录使用 macos-arm64，mac-arm64 会让干净环境构建返回 404。
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.17.2/macos-arm64/ZCode-3.17.2-mac-arm64.zip",
    archiveSha512:
      "Vp5+uPF5LXkIwbOVkpXLSI0qFjhNmY/9YwEjOnNiRIdznP1JX7PZE2mfo1/Sc6YwLn8jl77Ozf5oHV9QDTRoFw==",
    member:
      "ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app/Contents/Resources/ax_native.node",
  },
  "win32-x64": {
    version: "3.17.2",
    sha256: "11f8bc9c053636fd7199a1e5802a82df652db6bf5ae232165bc530da7530b534",
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.17.2/windows-x64/ZCode-3.17.2-win-x64.exe",
    archiveSha512:
      "3n9TNUmQFG/3uKdvJldemQIBoBmgrxexgI+47mNYh+iVPvyHyAOGWC97fk8kGhRcyOJ8FfHvSiqkgreOMwjhfQ==",
    member: "resources/tools/cua-helper/build/Release/ax_native.node",
  },
  "win32-arm64": {
    version: "3.17.2",
    sha256: "43b4d37b8a022dcfe6a6292f433b2ca1792e5256f70f497e25ca47719bf6e1f4",
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.17.2/windows-arm64/ZCode-3.17.2-win-arm64.exe",
    archiveSha512:
      "qXW+jsTnZpCIsp4gVNJEm/RZJMElcW3HToXCcwXyAChD7xrnbf+qgQNA1zWgg0LapULL0k1uCzHZBWbXnfdJ3Q==",
    member: "resources/tools/cua-helper/build/Release/ax_native.node",
  },
});

export async function verifyNativeAsset(
  path,
  { platform = process.platform, arch = process.arch, requireManifest = true } = {},
) {
  const key = `${platform}-${arch}`;
  const asset = NATIVE_ASSETS[key];
  if (!asset) throw new Error(`No verified computer control native asset for ${key}.`);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== asset.sha256)
    throw new Error(
      `Computer control native integrity mismatch for ${key}. Re-import official ${asset.version} assets.`,
    );
  if (requireManifest) {
    const manifest = JSON.parse(await readFile(join(dirname(path), "runtime.json"), "utf8"));
    if (
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      manifest.version !== asset.version ||
      manifest.sha256 !== sha256 ||
      typeof manifest.helperSha256 !== "string"
    )
      throw new Error("Computer control runtime manifest does not match this process.");
    const helper = await readFile(join(dirname(path), "helper.mjs"));
    if (createHash("sha256").update(helper).digest("hex") !== manifest.helperSha256)
      throw new Error("Computer control helper integrity mismatch.");
    if (platform === "darwin") {
      const bridge = await readFile(join(dirname(path), "cocoa-runloop.node"));
      if (createHash("sha256").update(bridge).digest("hex") !== manifest.cocoaRunLoopSha256)
        throw new Error("Computer control Cocoa bridge integrity mismatch.");
    }
  }
  return asset;
}
