import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openComputerUseStateDirectory, withDesktopControlLease } from "./open-control-lease.mjs";
import { createNativeService, nativePermissions } from "./native-client.mjs";

export const OPEN_CUA_NATIVE_ENV = "ZCODE_OPEN_CUA_NATIVE";
export const OPEN_CUA_PERMISSION_APP_ENV = "ZCODE_OPEN_CUA_PERMISSION_APP_PATH";
export const OPEN_CUA_MINIMUM_MACOS_VERSION = "14.0";

export function isOpenComputerUseSupported({ platform = process.platform, macOsVersion } = {}) {
  if (platform === "win32") return true;
  if (platform !== "darwin") return false;
  const major =
    macOsVersion === undefined
      ? Number.parseInt(release(), 10) - 9
      : Number.parseInt(macOsVersion, 10);
  return Number.isFinite(major) && major >= 14;
}

export function resolveOpenComputerUseNative({
  env = process.env,
  arch = process.arch,
  platform = process.platform,
} = {}) {
  return (
    env[OPEN_CUA_NATIVE_ENV]?.trim() ||
    fileURLToPath(
      new URL(
        `./native-bin/${platform}-${arch}/${platform === "darwin" && arch === "x64" ? "OpenZCodeNative" : "ax_native.node"}`,
        import.meta.url,
      ),
    )
  );
}

function markerPath() {
  return join(openComputerUseStateDirectory(), "permissions-generation");
}

export async function readOpenComputerUseRefreshMarker() {
  try {
    return await readFile(markerPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "initial";
    throw error;
  }
}

export async function refreshOpenComputerUsePermissions() {
  await mkdir(openComputerUseStateDirectory(), { recursive: true, mode: 0o700 });
  const path = markerPath();
  const temporaryPath = `${path}.${randomUUID()}`;
  await writeFile(temporaryPath, randomUUID(), { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
}

export async function readOpenComputerUsePermissions(options = {}) {
  if (!isOpenComputerUseSupported(options)) {
    return { available: false, reason: "电脑控制支持 macOS 14+ 和 Windows 本地桌面。" };
  }
  try {
    const executable = options.executable ?? resolveOpenComputerUseNative(options);
    await access(executable);
    const run = options.runUtility ?? (() => nativePermissions(executable));
    const report = await run();
    if (
      typeof report?.accessibility !== "boolean" ||
      typeof report?.screenRecording !== "boolean"
    ) {
      throw new Error("电脑控制返回了无效的权限状态。");
    }
    const appPath = (options.env ?? process.env)[OPEN_CUA_PERMISSION_APP_ENV];
    const displayName = appPath ? basename(appPath, ".app") : "CodeVori";
    let screenCaptureProbeOk = false;
    if (options.probeScreenCapture === true && report.screenRecording) {
      try {
        screenCaptureProbeOk = await (
          options.probe ??
          (() =>
            withDesktopControlLease(async () => {
              const { service } = createNativeService({ executable });
              try {
                await service.start();
                const result = await service.callTool("list_apps", {});
                const apps = JSON.parse(result.content[0].text);
                const app = apps.find((candidate) => candidate.pid !== process.pid);
                if (!app) return false;
                const capture = await service.callTool("get_app_state", {
                  app_ref: { pid: app.pid },
                  include_screenshot: true,
                });
                return !capture.isError && capture.content.some((part) => part.type === "image");
              } finally {
                await service.close();
              }
            }))
        )();
      } catch {
        screenCaptureProbeOk = false;
      }
    }
    return {
      available: true,
      platform: options.platform ?? process.platform,
      grantOwner: displayName,
      grantOwnerDisplayName: displayName,
      accessibility: report.accessibility ? "granted" : "denied",
      accessibilityProbeOk: report.accessibility,
      screenRecording: report.screenRecording ? "granted" : "denied",
      screenCaptureProbeOk,
    };
  } catch (error) {
    return {
      available: false,
      reason:
        error.code === "ENOENT"
          ? "电脑控制原生组件尚未构建，请运行 pnpm --filter @zcode/zcode-cua build:native。"
          : `电脑控制权限检查失败：${error.message}`,
    };
  }
}
