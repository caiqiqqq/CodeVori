import type { IPlatformService } from "@zcode/shared";

// 当前开源 native 只支持 macOS，Windows/Linux/普通 Web 没有本机控制能力。
// 因此权限弹窗、预检和 Helper 状态轮询都必须先判定本地是 macOS desktop。
// 用 navigator.userAgent 判定，并显式排除 iOS（iPhone/iPad 的 UA 含 Macintosh 子串）。
//
// 由模块级常量改为惰性函数。原常量在模块 import 时求值，导致按 UA 分支的单测
// 无法在同一进程内覆盖多平台（改 navigator.userAgent 对已求值的常量无效）。运行时行为等价——
// 真实环境里 UA 不会中途变化。
function isMacOsDesktopUserAgent(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Macintosh|Mac OS X/.test(navigator.userAgent) &&
    !/iPhone|iPad|iPod/.test(navigator.userAgent)
  );
}

/**
 * CUA 权限 UI 的真实平台能力门。
 *
 * 仅看 UA 会把 macOS Safari/Web 误判成 desktop，打开一个无法执行任何本机 IPC 的权限弹窗。
 * desktop preload 只在具备该能力时注入 onboarding 方法，因此 UA + capability 必须同时满足。
 */
export function supportsLocalMacCuaPermissionOnboarding(
  platform: Pick<IPlatformService, "openCuaPermissionOnboarding"> | null | undefined,
): boolean {
  return isMacOsDesktopUserAgent() && typeof platform?.openCuaPermissionOnboarding === "function";
}

/**
 * 保留 Windows 能力查询接口供现有 composer 调用，开源 runtime 始终返回不支持。
 */
export function supportsLocalWindowsCuaEntry(
  _platform: Pick<IPlatformService, "executeDesktopCommand"> | null | undefined,
): boolean {
  // 上游只提供 macOS native，不能把桌面 IPC 当作 Windows 控制能力。
  return false;
}
