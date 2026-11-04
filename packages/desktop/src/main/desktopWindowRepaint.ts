import type { BrowserWindow } from "electron";

export function attachWindowsWindowRepaint(
  targetWindow: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32") {
    return;
  }

  let pendingRepaintTimer: ReturnType<typeof setTimeout> | null = null;
  const repaint = () => {
    if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return;
    }

    targetWindow.webContents.invalidate();
  };

  const scheduleRepaint = () => {
    repaint();
    if (pendingRepaintTimer !== null) {
      clearTimeout(pendingRepaintTimer);
    }
    pendingRepaintTimer = setTimeout(() => {
      pendingRepaintTimer = null;
      repaint();
    }, 32);
  };

  targetWindow.on("resized", () => {
    // Windows 手动拉伸结束后，Electron/Chromium 偶发只更新窗口 bounds，
    // 但 renderer 最后一帧没有完整 repaint，新扩展区域会留下宿主底色。resized 是低频结束事件，
    // 这里补一次完整窗口重绘，确保内容层按最终 viewport 尺寸重新铺满。
    scheduleRepaint();
  });
  targetWindow.on("show", () => {
    // Windows Acrylic 窗口 hide 到托盘后再次 show 时可能继续复用失效的合成 surface，
    // renderer 与 host 仍存活但窗口只剩宿主底色；复用 resize 的有界双帧重绘，不 reload renderer 或会话。
    scheduleRepaint();
  });
  targetWindow.on("focus", () => {
    // 修复原因：被其他程序完全遮挡后 Alt-Tab 只触发 focus，原 show/resized 补丁不会执行。
    // 按官方修复复用有界双帧重绘，让 Chromium 重新提交画面，不重载 renderer 或会话。
    scheduleRepaint();
  });
  targetWindow.once("closed", () => {
    if (pendingRepaintTimer !== null) clearTimeout(pendingRepaintTimer);
    pendingRepaintTimer = null;
  });
}
