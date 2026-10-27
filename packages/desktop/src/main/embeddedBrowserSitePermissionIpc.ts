import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { PlatformChannels } from "@zcode/shared";
import type {
  EmbeddedBrowserSitePermissionController,
  SitePermissionAction,
} from "./embeddedBrowserSitePermissionController.js";

export function registerEmbeddedBrowserSitePermissionIpc(
  controller: EmbeddedBrowserSitePermissionController,
): void {
  // guest/子 frame 不能代替宿主窗口回答或修改授权；requestId 还会绑定到具体宿主。
  const trustedWindow = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame &&
    BrowserWindow.fromWebContents(event.sender) !== null;
  ipcMain.on(PlatformChannels.ResolveEmbeddedBrowserSitePermissionPrompt, (event, raw: unknown) => {
    if (!trustedWindow(event) || !raw || typeof raw !== "object") return;
    const { requestId, action, selectionId } = raw as {
      requestId?: unknown;
      action?: unknown;
      selectionId?: unknown;
    };
    if (
      typeof requestId !== "string" ||
      !["allow-always", "allow-session", "dismiss", "select"].includes(action as string)
    )
      return;
    controller.resolve(
      event.sender.id,
      requestId,
      action as SitePermissionAction | "select",
      typeof selectionId === "string" ? selectionId : undefined,
    );
  });
  ipcMain.handle(PlatformChannels.GetEmbeddedBrowserSitePermissions, (event) => {
    if (!trustedWindow(event)) throw new Error("untrusted permission settings request");
    return controller.snapshot();
  });
  ipcMain.handle(PlatformChannels.SetEmbeddedBrowserSitePermission, async (event, raw: unknown) => {
    if (!trustedWindow(event) || !raw || typeof raw !== "object")
      throw new Error("invalid permission settings request");
    const { origin, permission, state } = raw as Record<string, unknown>;
    if (
      typeof origin !== "string" ||
      typeof permission !== "string" ||
      (state !== "allow" && state !== "deny" && state !== "ask")
    )
      throw new Error("invalid permission settings request");
    await controller.set(origin, permission, state);
    return controller.snapshot();
  });
  ipcMain.handle(
    PlatformChannels.ResetEmbeddedBrowserSitePermission,
    async (event, origin: unknown) => {
      if (!trustedWindow(event) || typeof origin !== "string")
        throw new Error("invalid permission settings request");
      await controller.reset(origin);
      return controller.snapshot();
    },
  );
  ipcMain.handle(PlatformChannels.ClearEmbeddedBrowserSitePermissions, async (event) => {
    if (!trustedWindow(event)) throw new Error("untrusted permission settings request");
    await controller.clear();
    return controller.snapshot();
  });
}
