import { release } from "node:os";
import type { CuaOsSupport } from "@zcode/shared";

// 与开源 Swift 包的 .macOS(.v14) 和 native target triple 一致。
const CUA_MINIMUM_MACOS_VERSION = "14.0";
const CUA_MINIMUM_DARWIN_MAJOR = 23; // 开源 ScreenCaptureKit runtime 的最低版本是 macOS 14。

function darwinMajorToMacosMajor(major: number): number {
  return major - 9;
}

export function resolveCuaOsSupport(
  platform = process.platform,
  darwinRelease = release(),
): CuaOsSupport {
  if (platform !== "darwin") return { kind: "not-applicable" };
  const major = Number.parseInt(darwinRelease.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major)) return { kind: "supported" };
  if (major < CUA_MINIMUM_DARWIN_MAJOR) {
    return {
      kind: "macos-below-minimum",
      minimumMacOs: CUA_MINIMUM_MACOS_VERSION,
      currentMacOs: String(darwinMajorToMacosMajor(major)),
    };
  }
  return { kind: "supported" };
}
