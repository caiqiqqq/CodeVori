import { ipcMain } from "electron";
import { PlatformChannels, type ChromeBrowserDataImportOptions } from "@zcode/shared";
import { clearEmbeddedBrowserData, importChromeBrowserData } from "./browserDataManager.js";
import { getActiveEmbeddedBrowserSitePermissionController } from "./embeddedBrowserSitePermissionController.js";

export function registerBrowserDataIpcHandlers(logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}) {
  ipcMain.handle(PlatformChannels.ImportChromeBrowserData, (_event, value: unknown) => {
    const requested = value as ChromeBrowserDataImportOptions | undefined;
    // renderer 只能为本次调用显式传 true；main 不接受或持久化其他授权形态。
    const allowElevatedChromeDecryption = requested?.allowElevatedChromeDecryption === true;
    return importChromeBrowserData({ allowElevatedChromeDecryption, logger });
  });
  ipcMain.handle(PlatformChannels.ClearEmbeddedBrowserData, async (_event, mode: unknown) => {
    if (mode !== "cache" && mode !== "all") {
      return { success: false, error: "invalid_clear_mode" };
    }
    const result = await clearEmbeddedBrowserData({ logger, mode });
    if (result.success && mode === "all")
      await getActiveEmbeddedBrowserSitePermissionController()?.clear();
    return result;
  });
}
