import { homedir } from "node:os";
import { join } from "node:path";
import { PRODUCT_SETTINGS_DIRECTORY_NAME } from "../product-brand.mjs";

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
} {
  return { settingsFile: join(homePath, PRODUCT_SETTINGS_DIRECTORY_NAME, "v2", "setting.json") };
}
