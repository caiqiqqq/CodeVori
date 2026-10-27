import type { DesktopCapturerSource, Session, WebContents, WebFrameMain } from "electron";
import type { EmbeddedBrowserSitePermissionController } from "./embeddedBrowserSitePermissionController.js";
import { normalizeSitePermissionOrigin } from "./embeddedBrowserSitePermissionController.js";

type Device = {
  deviceId?: string;
  portId?: string;
  name?: string;
  productName?: string;
  deviceName?: string;
  portName?: string;
};
const deviceId = (device: Device) => device.deviceId ?? device.portId ?? "";
const options = (devices: Device[]) =>
  devices
    .filter((item) => deviceId(item))
    .map((item) => ({
      id: deviceId(item),
      name: item.name || item.productName || item.deviceName || item.portName || deviceId(item),
    }));

export function isDeviceDiscoveryAllowed(
  contents: WebContents | null,
  origin: string,
  permission: string,
): boolean {
  // discovery 仅打开选择器；真正的 getDevices 权限由选中过的设备白名单决定，不能恒 true。
  return (
    ["usb", "hid", "serial", "bluetooth"].includes(permission) &&
    !!contents?.hostWebContents &&
    normalizeSitePermissionOrigin(origin) !== null
  );
}

export function installEmbeddedBrowserDeviceSelection(
  browserSession: Session,
  controller: EmbeddedBrowserSitePermissionController,
  deps: {
    fromFrame: (frame: WebFrameMain) => WebContents | undefined;
    getSources: () => Promise<DesktopCapturerSource[]>;
    warn: (...args: unknown[]) => void;
  },
) {
  function owner(contents: WebContents | undefined, frame: WebFrameMain | null) {
    if (!contents || contents.isDestroyed() || contents.session !== browserSession || !frame)
      return null;
    const host = contents.hostWebContents;
    const url = frame.url;
    const origin = normalizeSitePermissionOrigin(url);
    if (!host || host.isDestroyed() || !origin) return null;
    const alive = () => {
      try {
        return !contents.isDestroyed() && !host.isDestroyed() && frame.url === url;
      } catch {
        return false;
      }
    };
    return { contents, host, origin, alive };
  }

  function watch(binding: NonNullable<ReturnType<typeof owner>>, cancel: () => void) {
    // 即使同源重载 URL 未变，旧 frame 的回复也不能授权新文档。
    binding.contents.on("did-start-navigation", cancel);
    binding.contents.on("destroyed", cancel);
    binding.host.on("destroyed", cancel);
    return () => {
      binding.contents.removeListener("did-start-navigation", cancel);
      binding.contents.removeListener("destroyed", cancel);
      binding.host.removeListener("destroyed", cancel);
    };
  }

  function chooseDevice(
    binding: ReturnType<typeof owner>,
    type: string,
    devices: Device[],
    callback: (id: string) => void,
  ) {
    if (!binding) {
      callback("");
      return null;
    }
    const picker = controller.choose({
      hostId: binding.host.id,
      guestWebContentsId: binding.contents.id,
      origin: binding.origin,
      permission: type,
      choices: options(devices),
    });
    const unwatch = watch(binding, picker.cancel);
    void picker.result.then((id) => {
      unwatch();
      const selected = binding.alive() ? id : null;
      if (selected && type !== "bluetooth") controller.grantDevice(binding.origin, type, selected);
      // Electron 在 frame 销毁后可能抛错；回调只调用一次，不能在 catch 中再次拒绝。
      try {
        callback(selected ?? "");
      } catch (error) {
        deps.warn("device selection callback expired", error);
      }
    });
    return picker;
  }

  browserSession.setDevicePermissionHandler(({ origin, deviceType, device }) =>
    controller.checkDevice(origin, deviceType, deviceId(device)),
  );

  browserSession.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const binding = owner(details.frame ? deps.fromFrame(details.frame) : undefined, details.frame);
    let devices: Device[] = [...details.deviceList];
    const picker = chooseDevice(binding, "usb", devices, (id) => callback(id || undefined));
    if (!picker || !binding) return;
    const added = (_event: unknown, device: Electron.USBDevice, source: WebContents) => {
      if (source !== binding.contents) return;
      devices = [...devices.filter((item) => deviceId(item) !== device.deviceId), device];
      picker.update(options(devices));
    };
    const removed = (_event: unknown, device: Electron.USBDevice, source: WebContents) => {
      if (source !== binding.contents) return;
      devices = devices.filter((item) => deviceId(item) !== device.deviceId);
      picker.update(options(devices));
    };
    browserSession.on("usb-device-added", added);
    browserSession.on("usb-device-removed", removed);
    void picker.result.finally(() => {
      browserSession.off("usb-device-added", added);
      browserSession.off("usb-device-removed", removed);
    });
  });
  browserSession.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const binding = owner(details.frame ? deps.fromFrame(details.frame) : undefined, details.frame);
    let devices: Device[] = [...details.deviceList];
    const picker = chooseDevice(binding, "hid", devices, (id) => callback(id || undefined));
    if (!picker || !binding) return;
    const added = (_event: unknown, change: Electron.HidDeviceAddedDetails) => {
      if (change.frame !== details.frame) return;
      const device = change.device;
      devices = [...devices.filter((item) => deviceId(item) !== device.deviceId), device];
      picker.update(options(devices));
    };
    const removed = (_event: unknown, change: Electron.HidDeviceRemovedDetails) => {
      if (change.frame !== details.frame) return;
      const device = change.device;
      devices = devices.filter((item) => deviceId(item) !== device.deviceId);
      picker.update(options(devices));
    };
    browserSession.on("hid-device-added", added);
    browserSession.on("hid-device-removed", removed);
    void picker.result.finally(() => {
      browserSession.off("hid-device-added", added);
      browserSession.off("hid-device-removed", removed);
    });
  });
  browserSession.on("select-serial-port", (event, ports, contents, callback) => {
    event.preventDefault();
    const picker = chooseDevice(owner(contents, contents.mainFrame), "serial", ports, callback);
    if (!picker) return;
    let devices: Device[] = [...ports];
    const added = (_event: unknown, port: Electron.SerialPort, source: WebContents) => {
      if (source !== contents) return;
      devices = [...devices.filter((item) => deviceId(item) !== port.portId), port];
      picker.update(options(devices));
    };
    const removed = (_event: unknown, port: Electron.SerialPort, source: WebContents) => {
      if (source !== contents) return;
      devices = devices.filter((item) => deviceId(item) !== port.portId);
      picker.update(options(devices));
    };
    browserSession.on("serial-port-added", added);
    browserSession.on("serial-port-removed", removed);
    void picker.result.finally(() => {
      browserSession.off("serial-port-added", added);
      browserSession.off("serial-port-removed", removed);
    });
  });
  browserSession.on("usb-device-revoked", (_event, details) => {
    if (details.origin) controller.revokeDevice(details.origin, "usb", deviceId(details.device));
  });
  browserSession.on("hid-device-revoked", (_event, details) => {
    if (details.origin) controller.revokeDevice(details.origin, "hid", deviceId(details.device));
  });
  browserSession.on("serial-port-revoked", (_event, details) => {
    controller.revokeDevice(details.origin, "serial", deviceId(details.port));
  });
  browserSession.setDisplayMediaRequestHandler((request, callback) => {
    const binding = owner(request.frame ? deps.fromFrame(request.frame) : undefined, request.frame);
    let settled = false;
    const finish = (source?: DesktopCapturerSource) => {
      if (settled) return;
      settled = true;
      // Electron 41 拒绝 display capture 时可同步抛 TypeError，不能重复调用 callback。
      try {
        callback(source ? { video: source } : {});
      } catch (error) {
        deps.warn("display selection callback expired", error);
      }
    };
    if (
      !binding ||
      !request.videoRequested ||
      normalizeSitePermissionOrigin(request.securityOrigin) !== binding.origin
    ) {
      finish();
      return;
    }
    const picker = controller.choose({
      hostId: binding.host.id,
      guestWebContentsId: binding.contents.id,
      origin: binding.origin,
      permission: "display",
      choices: [],
    });
    const unwatch = watch(binding, picker.cancel);
    let sources: DesktopCapturerSource[] = [];
    void deps
      .getSources()
      .then((next) => {
        sources = next;
        if (!binding.alive()) {
          picker.cancel();
          return;
        }
        picker.update(
          sources.map((source) => ({
            id: source.id,
            name: source.name,
            thumbnailDataUrl: source.thumbnail.toDataURL(),
          })),
        );
      })
      .catch((error) => {
        deps.warn("display source enumeration failed", error);
        picker.cancel();
      });
    void picker.result.then((id) => {
      unwatch();
      finish(binding.alive() ? sources.find((source) => source.id === id) : undefined);
    });
  });

  return {
    attachGuest(contents: WebContents) {
      if (contents.session !== browserSession || contents.getType() !== "webview") return;
      let current: ReturnType<typeof chooseDevice> = null;
      contents.on("select-bluetooth-device", (event, devices, callback) => {
        event.preventDefault();
        if (current) {
          current.update(options(devices));
          return;
        }
        const picker = chooseDevice(
          owner(contents, contents.mainFrame),
          "bluetooth",
          devices,
          callback,
        );
        current = picker;
        if (picker)
          void picker.result.finally(() => {
            if (current === picker) current = null;
          });
      });
    },
  };
}
