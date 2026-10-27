import { app, Menu, nativeImage, Tray, type NativeImage } from "electron";
import { join } from "node:path";
import {
  DesktopCommandIds,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  ZCODE_PRODUCT_FLAVOR,
  type DesktopCommandId,
  type Locale,
} from "@zcode/shared";
import { createUnreadDotBitmap } from "./unreadBadge.js";

let desktopTray: Tray | null = null;
let rebuildDesktopTrayContextMenu: (() => void) | null = null;
let desktopTrayBaseIcon: NativeImage | null = null;
let desktopTrayUnreadCount = 0;

function resolveDesktopTrayIconPath(platform: NodeJS.Platform) {
  if (platform === "linux") {
    return app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(import.meta.dirname, "../../build/icon.png");
  }
  return app.isPackaged
    ? join(process.resourcesPath, "tray_icon.ico")
    : join(import.meta.dirname, "../../build/icon.ico");
}

export function createDesktopTray(options: {
  platform?: NodeJS.Platform;
  getLocale: () => Locale;
  showCurrentWindow: () => Promise<void> | void;
  executeDesktopCommand: (command: DesktopCommandId) => Promise<unknown>;
  quitApp: () => void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "linux") {
    return null;
  }

  if (desktopTray) {
    return desktopTray;
  }

  try {
    desktopTrayBaseIcon = nativeImage.createFromPath(resolveDesktopTrayIconPath(platform));
    if (desktopTrayBaseIcon.isEmpty()) {
      throw new Error("tray icon asset is empty");
    }
    desktopTray = new Tray(desktopTrayBaseIcon);
  } catch (error) {
    options.logger.warn("[desktop-tray] failed to create tray icon", error);
    return null;
  }

  const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getDesktopMenuMessage(options.getLocale(), id);
  const showTrayWindow = () => {
    void Promise.resolve(options.showCurrentWindow()).catch((error) => {
      options.logger.warn("[desktop-tray] failed to show current window", error);
    });
  };
  const executeTrayCommand = (command: DesktopCommandId) => {
    void Promise.resolve(options.showCurrentWindow())
      .then(() => options.executeDesktopCommand(command))
      .catch((error) => {
        options.logger.warn(`[desktop-tray] failed to execute tray command ${command}`, error);
      });
  };
  const rebuildContextMenu = () => {
    desktopTray?.setToolTip(getLabel(desktopMenuMessageIds.trayTooltip));
    desktopTray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: getLabel(desktopMenuMessageIds.trayOpenZCode),
          click: showTrayWindow,
        },
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.fileNewTask),
          click: () => executeTrayCommand(DesktopCommandIds.NewTask),
        },
        {
          label: getLabel(desktopMenuMessageIds.fileOpenWorkspace),
          click: () => executeTrayCommand(DesktopCommandIds.OpenWorkspace),
        },
        { type: "separator" },
        // 更新入口跟随产品身份：Preview（含生产后端的 Preview）禁用更新器，托盘也不能露出入口。
        ...(ZCODE_PRODUCT_FLAVOR === "production"
          ? [
              {
                label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
                click: () => executeTrayCommand(DesktopCommandIds.CheckForUpdates),
              },
            ]
          : []),
        {
          label: getLabel(desktopMenuMessageIds.helpAbout),
          click: () => executeTrayCommand(DesktopCommandIds.ShowAbout),
        },
        // 与帮助菜单一致，暂时隐藏“清除所有数据”，避免托盘仍露出同一入口。
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.trayQuit),
          click: () => options.quitApp(),
        },
      ]),
    );
  };

  rebuildDesktopTrayContextMenu = rebuildContextMenu;
  updateWindowsDesktopTrayUnreadCount(desktopTrayUnreadCount);
  desktopTray.on("click", showTrayWindow);
  desktopTray.on("double-click", showTrayWindow);
  rebuildContextMenu();

  return desktopTray;
}

export function isDesktopTrayReady(): boolean {
  return desktopTray !== null;
}

export function updateWindowsDesktopTrayMenu() {
  rebuildDesktopTrayContextMenu?.();
}

export function updateWindowsDesktopTrayUnreadCount(count: number) {
  desktopTrayUnreadCount = count;
  if (process.platform !== "win32" || !desktopTray || !desktopTrayBaseIcon) return;
  if (count === 0) {
    desktopTray.setImage(desktopTrayBaseIcon);
    return;
  }
  const width = 32;
  const height = 32;
  const bitmap = desktopTrayBaseIcon.resize({ width, height }).toBitmap();
  if (bitmap.length !== width * height * 4) return;
  desktopTray.setImage(
    nativeImage.createFromBitmap(createUnreadDotBitmap(bitmap, width, height), {
      width,
      height,
    }),
  );
}
