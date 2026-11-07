import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { resolveAppSettingsPaths } from "@zcode/shared/node";
import {
  PRODUCT_DATA_DIRECTORY_NAME,
  PRODUCT_LEGACY_DATA_DIRECTORY_NAME,
  PRODUCT_NAME,
} from "@zcode/shared/product-brand";
import { migrateLegacyDesktopData } from "./desktopLegacyDataMigration.js";

async function readLegacyCustomDataBaseDir(userHome: string): Promise<string | null> {
  const { legacySettingsFile: settingsFile } = resolveAppSettingsPaths(userHome);
  try {
    const settings = JSON.parse(await readFile(settingsFile, "utf8")) as { dataBaseDir?: unknown };
    const value = typeof settings.dataBaseDir === "string" ? settings.dataBaseDir.trim() : "";
    return value && isAbsolute(value) && resolve(value) !== resolve(userHome) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function showMigrationError(
  kind: "legacy-running" | "migration-running" | "failed",
  parent: BrowserWindow,
  error?: unknown,
): Promise<void> {
  const chinese = app.getLocale().toLowerCase().startsWith("zh");
  const title = chinese ? "CodeVori 数据迁移" : "CodeVori data migration";
  const message =
    kind === "legacy-running"
      ? chinese
        ? "首次迁移前，请关闭旧版 ZCode 和仍使用旧目录的 CodeVori，然后重新打开新版 CodeVori。迁移完成后两款软件可同时运行。"
        : "Before the first migration, close ZCode and any CodeVori version still using the old data folder. Reopen the updated CodeVori; both apps can then run together."
      : kind === "migration-running"
        ? chinese
          ? "另一个 CodeVori 启动进程正在迁移数据。请等待它完成，然后重新打开。"
          : "Another CodeVori process is migrating data. Wait for it to finish, then reopen."
        : chinese
          ? "CodeVori 未能复制旧数据。旧版 ZCode 数据仍然保留；请检查磁盘空间和目录权限后重试。"
          : "CodeVori could not copy the old data. ZCode data is intact. Check disk space and folder permissions, then retry.";
  await dialog.showMessageBox(parent, {
    type: "error",
    title,
    message,
    detail: error instanceof Error ? error.message : undefined,
  });
}

async function showMigrationWindow(): Promise<BrowserWindow> {
  await app.whenReady();
  const chinese = app.getLocale().toLowerCase().startsWith("zh");
  const title = chinese ? "CodeVori 数据迁移" : "CodeVori data migration";
  const heading = chinese ? "正在准备 CodeVori 数据" : "Preparing CodeVori data";
  const detail = chinese
    ? "首次启动需要复制旧数据，数据较多时可能需要几分钟。请保持应用运行。"
    : "The first launch copies existing data. This may take several minutes; keep the app running.";
  const window = new BrowserWindow({
    width: 460,
    height: 180,
    resizable: false,
    minimizable: false,
    title,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  window.on("close", (event) => event.preventDefault());
  const html = `<!doctype html><html lang="${chinese ? "zh" : "en"}"><meta charset="utf-8"><style>body{font:14px system-ui,sans-serif;color:#20232a;margin:28px}h1{font-size:18px;margin:0 0 16px}p{line-height:1.6;margin:0}@media(prefers-color-scheme:dark){body{background:#20232a;color:#f5f5f5}}</style><h1>${heading}</h1><p>${detail}</p></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  window.show();
  return window;
}

async function start(): Promise<void> {
  // 迁移窗口关闭到主窗口建立之间没有其他窗口；阻止 Electron 在 Windows/Linux 自动退出。
  const keepAlive = (): void => {};
  app.on("window-all-closed", keepAlive);
  // 开发态与显式隔离测试实例已经有专属目录；只迁移正常安装的产品 profile。
  if (app.isPackaged && !process.env.ZCODE_DESKTOP_APPLICATION_NAME?.trim()) {
    const userHome = homedir();
    const appData = app.getPath("appData");
    const preview = ZCODE_PRODUCT_FLAVOR === "preview";
    const legacyProfile = join(appData, preview ? "ZCode Preview" : "ZCode");
    const productProfile = join(appData, preview ? `${PRODUCT_NAME} Preview` : PRODUCT_NAME);
    const legacyDataRoots = [
      {
        source: join(userHome, PRODUCT_LEGACY_DATA_DIRECTORY_NAME),
        target: join(userHome, PRODUCT_DATA_DIRECTORY_NAME),
      },
    ];
    // 修复原因：首启复制旧数据可能耗时数分钟；先显示窗口，避免用户只看到进程而误以为启动失败。
    const progressWindow = await showMigrationWindow();
    try {
      const result = await migrateLegacyDesktopData({
        legacyDataRoots,
        resolveAdditionalLegacyDataRoots: async () => {
          const customBaseDir = await readLegacyCustomDataBaseDir(userHome);
          return customBaseDir
            ? [
                {
                  source: join(customBaseDir, PRODUCT_LEGACY_DATA_DIRECTORY_NAME),
                  target: join(customBaseDir, PRODUCT_DATA_DIRECTORY_NAME),
                },
              ]
            : [];
        },
        legacyProfile,
        productProfile,
        migrationLock: `${productProfile}.migration-lock`,
      });
      if (result === "legacy-running" || result === "migration-running") {
        await showMigrationError(result, progressWindow);
        progressWindow.destroy();
        app.quit();
        return;
      }
    } catch (error) {
      await showMigrationError("failed", progressWindow, error);
      progressWindow.destroy();
      app.quit();
      return;
    } finally {
      if (!progressWindow.isDestroyed()) progressWindow.destroy();
    }
  }
  await import("./index.js");
  app.off("window-all-closed", keepAlive);
}

void start();
