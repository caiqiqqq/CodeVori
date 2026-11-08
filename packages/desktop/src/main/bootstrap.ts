import "./desktopEarlyDataBaseDirBootstrap.js";
import "./desktopEarlyChromiumHardwareAccelerationBootstrap.js";
// SDK 在导入时注册特权协议，必须在 app ready 前静态加载。
import "@arms/rum-electron";
import { app, dialog, protocol } from "electron";
import { BROWSER_LOCAL_PREVIEW_PRIVILEGES } from "./browser-local-preview/index.js";
import { registerLocalMediaPreviewScheme } from "./localMediaPreviewProtocol.js";
import {
  runtimeApplicationName,
  runtimeHomePath,
  runtimeSessionDataPath,
  runtimeUserDataPath,
  shouldUseElectronDefaultUserDataPath,
} from "./desktopRuntimeEnv.js";

registerLocalMediaPreviewScheme(protocol);
protocol.registerSchemesAsPrivileged([BROWSER_LOCAL_PREVIEW_PRIVILEGES]);
if (!app.isPackaged && process.env.ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT !== "1") {
  app.commandLine.appendSwitch("remote-debugging-port", "9229");
}
app.setName(runtimeApplicationName);
if (runtimeHomePath) app.setPath("home", runtimeHomePath);
if (!shouldUseElectronDefaultUserDataPath) {
  if (!runtimeUserDataPath || !runtimeSessionDataPath) {
    throw new Error(
      "Desktop runtime data paths are required when Electron default userData is disabled",
    );
  }
  app.setPath("userData", runtimeUserDataPath);
  app.setPath("sessionData", runtimeSessionDataPath);
}
process.title = runtimeApplicationName;

void import("./index.js").catch((error: unknown) => {
  dialog.showErrorBox(
    "CodeVori startup failed",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  app.quit();
});
