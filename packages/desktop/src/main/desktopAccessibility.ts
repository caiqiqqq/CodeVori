import type { App } from "electron";

export function enableDesktopAccessibility(app: Pick<App, "setAccessibilitySupportEnabled">): void {
  if (process.platform !== "darwin") return;
  // Electron 默认按需创建 renderer AX 树；仅返回窗口框架会让外部控制无法识别控件和焦点。
  // 由 Main 在 ready 后、创建窗口前统一启用，避免依赖外部 AX 开关或 VoiceOver 的状态。
  app.setAccessibilitySupportEnabled(true);
}
