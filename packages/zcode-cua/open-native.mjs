import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { openComputerUseStateDirectory, withDesktopControlLease } from "./open-control-lease.mjs";
import { HostClient, runNativeUtility } from "./vendor/open-zcode-computer-use/src/host-client.mjs";

const execFileAsync = promisify(execFile);
export const OPEN_CUA_NATIVE_ENV = "ZCODE_OPEN_CUA_NATIVE";
export const OPEN_CUA_PERMISSION_APP_ENV = "ZCODE_OPEN_CUA_PERMISSION_APP_PATH";
export const OPEN_CUA_MINIMUM_MACOS_VERSION = "14.0";

export function isOpenComputerUseSupported({ platform = process.platform, macOsVersion } = {}) {
  if (platform !== "darwin") return false;
  const major =
    macOsVersion === undefined
      ? Number.parseInt(release(), 10) - 9
      : Number.parseInt(macOsVersion, 10);
  return Number.isFinite(major) && major >= 14;
}

export function resolveOpenComputerUseNative({ env = process.env, arch = process.arch } = {}) {
  return (
    env[OPEN_CUA_NATIVE_ENV]?.trim() ||
    fileURLToPath(new URL(`./native-bin/darwin-${arch}/OpenZCodeNative`, import.meta.url))
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
    return { available: false, reason: "开源电脑控制仅支持 macOS 14 或更新版本。" };
  }
  try {
    const executable = options.executable ?? resolveOpenComputerUseNative(options);
    await access(executable);
    const run =
      options.runUtility ??
      (async () => {
        const { stdout } = await execFileAsync(executable, ["permissions"], {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
          encoding: "utf8",
        });
        return JSON.parse(stdout);
      });
    const report = await run();
    if (
      typeof report?.accessibility !== "boolean" ||
      typeof report?.screenRecording !== "boolean"
    ) {
      throw new Error("电脑控制返回了无效的权限状态。");
    }
    const appPath = (options.env ?? process.env)[OPEN_CUA_PERMISSION_APP_ENV];
    const displayName = appPath ? basename(appPath, ".app") : "ZCode";
    let screenCaptureProbeOk = false;
    if (options.probeScreenCapture === true && report.screenRecording) {
      try {
        screenCaptureProbeOk = await (
          options.probe ??
          (() =>
            withDesktopControlLease(async () => {
              const host = new HostClient({ executable, allowGlobalPointer: false });
              try {
                await host.start();
                const displays = await runNativeUtility("displays", [], { executable });
                if (!displays[0]) return false;
                const capture = await host.call("screen.capture", {
                  session: host.session,
                  displayId: displays[0].displayId,
                });
                return (
                  capture.ok !== false &&
                  capture.image?.widthPx > 0 &&
                  capture.image?.heightPx > 0 &&
                  (await stat(capture.image.path)).size > 8
                );
              } finally {
                await host.close();
              }
            }))
        )();
      } catch {
        screenCaptureProbeOk = false;
      }
    }
    return {
      available: true,
      platform: "darwin",
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
