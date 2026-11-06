import { existsSync, readFileSync } from "node:fs";
import { resolveAppSettingsPaths } from "@zcode/shared/node";
import { setDataBaseDir } from "@zcode/services/node";

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(): string | null {
  const { settingsFile, legacySettingsFile } = resolveAppSettingsPaths();
  // app ready 前保留原有同步启动边界；仅新文件缺失时只读旧值，异步迁移由设置入口完成。
  for (const file of [settingsFile, legacySettingsFile]) {
    if (!existsSync(file)) continue;
    try {
      return extractBootstrapDataBaseDir(JSON.parse(readFileSync(file, "utf-8")));
    } catch {
      return null;
    }
  }
  return null;
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (dataBaseDir) {
    // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
    // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
    setDataBaseDir(dataBaseDir);
  }
  return dataBaseDir;
}
