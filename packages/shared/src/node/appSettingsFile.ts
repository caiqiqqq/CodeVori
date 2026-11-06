import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRODUCT_SETTINGS_DIRECTORY_NAME } from "../product-brand.mjs";
import { atomicWritePrivateTextFile, withFileLock } from "./privateFilePersistence.js";

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function resolveSettingsHome(): string {
  return (
    process.env.ZCODE_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim() ||
    homedir()
  );
}

/** 设置固定属于用户 home，不跟随任务和日志的 dataBaseDir。 */
export function resolveAppSettingsPaths(homePath: string = resolveSettingsHome()): {
  settingsFile: string;
  legacySettingsFile: string;
} {
  return {
    settingsFile: join(homePath, PRODUCT_SETTINGS_DIRECTORY_NAME, "v2", "setting.json"),
    legacySettingsFile: join(homePath, ".zcode", "v2", "setting.json"),
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * 新文件是唯一事实源；缺失时在目标锁内从旧位置复制一次。
 * 只复制原始 JSON，不校验业务字段或删除源文件；字段迁移仍由 SettingService 负责。
 */
export async function prepareAppSettingsFile(homePath?: string): Promise<string> {
  const { settingsFile, legacySettingsFile } = resolveAppSettingsPaths(homePath);
  if (await fileExists(settingsFile)) return settingsFile;
  return withFileLock(settingsFile, async () => {
    // 修复依据：上游 ZCode 保存会丢弃 CodeVori 字段；迁移必须重查目标，
    // 防止另一个 Host 已迁移并保存后，被迟到的旧配置覆盖。
    if (await fileExists(settingsFile)) return settingsFile;
    let raw: string;
    try {
      raw = await readFile(legacySettingsFile, "utf8");
    } catch (error) {
      if (isNotFound(error)) return settingsFile;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Legacy app settings must be a JSON object");
    }
    await atomicWritePrivateTextFile(settingsFile, raw);
    return settingsFile;
  });
}
