import type { ZCodeProductFlavor } from "@zcode/shared";

export const CODEVORI_DESKTOP_MANIFEST_URL =
  "https://aimodetest.cn/api/v1/releases/electron/manifest";

export function resolveDesktopUpdatePolicy(flavor: ZCodeProductFlavor) {
  return {
    enabled: flavor === "production",
    // CodeVori 使用独立版本号，自有更新不能重新启用上游最低版本强更。
    checkOfficialMinimumVersion: false,
  } as const;
}
