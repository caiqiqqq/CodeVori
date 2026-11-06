import { existsSync, readFileSync } from "node:fs";
import { resolveAppSettingsPaths } from "@zcode/shared/node";

interface ChromiumHardwareAccelerationApp {
  disableHardwareAcceleration(): void;
}

function extractBootstrapChromiumHardwareAccelerationEnabled(rawValue: unknown): boolean {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return true;
  }

  const enabled = (
    rawValue as {
      desktopChromiumHardwareAccelerationEnabled?: unknown;
    }
  ).desktopChromiumHardwareAccelerationEnabled;
  return typeof enabled === "boolean" ? enabled : true;
}

function readBootstrapChromiumHardwareAccelerationEnabledFromDisk(): boolean {
  const { settingsFile, legacySettingsFile } = resolveAppSettingsPaths();
  // 硬件加速必须在 app ready 前应用；升级首启仅在新文件缺失时只读旧配置。
  for (const file of [settingsFile, legacySettingsFile]) {
    if (!existsSync(file)) continue;
    try {
      return extractBootstrapChromiumHardwareAccelerationEnabled(
        JSON.parse(readFileSync(file, "utf-8")),
      );
    } catch {
      return true;
    }
  }
  return true;
}

export function applyEarlyChromiumHardwareAccelerationBootstrap(
  app: ChromiumHardwareAccelerationApp,
  rawSettings?: unknown,
): boolean {
  const enabled =
    rawSettings === undefined
      ? readBootstrapChromiumHardwareAccelerationEnabledFromDisk()
      : extractBootstrapChromiumHardwareAccelerationEnabled(rawSettings);
  if (!enabled) {
    // Electron 只能在 app ready 前关闭 Chromium 硬件加速。
    // 因此设置页保存后必须在下一次 main 进程最早期读取并应用，不能等到 whenReady。
    app.disableHardwareAcceleration();
  }
  return enabled;
}
