import type { Session } from "electron";
import { isDeviceDiscoveryAllowed } from "./embeddedBrowserDeviceSelection.js";
import {
  isSilentSitePermission,
  type EmbeddedBrowserSitePermissionController,
} from "./embeddedBrowserSitePermissionController.js";

export function decideEmbeddedBrowserPermission(permission: string): boolean {
  return isSilentSitePermission(permission);
}

export function installEmbeddedBrowserPermissionBaseline(
  browserSession: Session,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  controller?: EmbeddedBrowserSitePermissionController,
): void {
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = decideEmbeddedBrowserPermission(permission);
    const requestingUrl = (details as { requestingUrl?: string }).requestingUrl;
    if (controller && isDeviceDiscoveryAllowed(contents, requestingUrl ?? "", permission)) {
      callback(true);
      return;
    }
    let origin = "unknown";
    try {
      origin = new URL(requestingUrl ?? "").origin;
    } catch {
      // An absent or invalid origin never grants access.
    }
    if (allowed || !controller) {
      logger.info("[embedded-browser-permission] request", { permission, origin, allowed });
      callback(allowed);
      return;
    }
    const hostId = contents.hostWebContents?.id;
    if (!hostId) {
      callback(false);
      return;
    }
    // 只有 guest 的真实宿主窗口能收到并回复权限请求；来源无效由控制器拒绝。
    void controller
      .request(
        requestingUrl ?? "",
        permission,
        hostId,
        contents.id,
        (details as { mediaTypes?: string[] }).mediaTypes,
      )
      .then(
        (granted) => {
          logger.info("[embedded-browser-permission] decision", { permission, allowed: granted });
          callback(granted);
        },
        (error: unknown) => {
          logger.warn("[embedded-browser-permission] request failed", error);
          callback(false);
        },
      );
  });
  browserSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      (controller && isDeviceDiscoveryAllowed(contents, requestingOrigin, permission)) ||
      (controller?.check(requestingOrigin, permission, details.mediaType) ??
        decideEmbeddedBrowserPermission(permission)),
  );
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.setDisplayMediaRequestHandler((_request, callback) => {
    logger.info("[embedded-browser-permission] display capture denied");
    try {
      callback({});
    } catch {
      /* Electron 41 拒绝共享时可能同步抛错，已完成回调不能再次结算。 */
    }
  });

  // Electron may otherwise choose the first matching device without a product decision.
  if (controller) return; // 专用适配器安装选择器；未安装时 Chromium 默认取消。
  browserSession.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  browserSession.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  browserSession.on("select-serial-port", (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback("");
  });
}
