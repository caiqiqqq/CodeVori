import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// 原因：公开 producer 是占位包；只能从已核对的正式发行物导入，不能把任意 .node 当作官方组件。
export const NATIVE_ASSETS = Object.freeze({
  "darwin-arm64": {
    version: "3.16.3",
    sha256: "9e8421b8660a92b00625ee6869a46e33e0f80ff8527cf7d4ddc9f66990e02adb",
    // 原因：官方下载目录使用 macos-arm64，mac-arm64 会让干净环境构建返回 404。
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.16.3/macos-arm64/ZCode-3.16.3-mac-arm64.zip",
    archiveSha512:
      "QUPUGmQk9jmhf7TJPKcxBtX3AzEVxLbQaIfRCQ13zibKzLgFgU7hx2qPyBZY3bK1OhClhlL3ddNwOriKRSIXIA==",
    member:
      "ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app/Contents/Resources/ax_native.node",
  },
  "win32-x64": {
    version: "3.16.3",
    sha256: "0dee894c4be5cd0b886aafaaea68aa505c6999a5e65afeb6527b08ba0e04274c",
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.16.3/windows-x64/ZCode-3.16.3-win-x64.exe",
    archiveSha512:
      "13o4qvOqKiRT8XeMECr5kx1aGIxNp8v43naAoBKRx5lorBOaove3lOe2YqiI5SjO9djXz7/cfYfhsBbEJJuGZw==",
    member: "resources/tools/cua-helper/build/Release/ax_native.node",
  },
  "win32-arm64": {
    version: "3.16.3",
    sha256: "f3ea55590ff21278403ed21a633861727a0de8163ae4ee217153d62598d98355",
    url: "https://cdn-zcode.z.ai/zcode/electron/releases/3.16.3/windows-arm64/ZCode-3.16.3-win-arm64.exe",
    archiveSha512:
      "on/J3jGMg8jgIbl9BznySD3CnvVWZ6va9JLnA+JIfd313wVKv0qHiWIk7MNIlxSJyWYjANmaIk7jpl3zdPENjA==",
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
