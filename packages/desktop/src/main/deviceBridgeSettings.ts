import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { app, ipcMain, shell, type UtilityProcess } from "electron";
import {
  deviceBridgeCommandSchema,
  deviceBridgeConfigurationSchema,
  PlatformChannels,
  type DeviceBridgeConfiguration,
} from "@zcode/shared";
import { createDeviceBridgeController } from "./deviceBridgeController.js";
import { startDeviceBridgeProcess } from "./deviceBridgeProcess.js";
import { checkDeviceBridgeMcp } from "./deviceBridgeMcpCheck.js";
import { removeTailscaleDevice } from "./deviceBridgeManagement.js";
import { saveCliMcpToUserDirectory } from "./mcpUserDirectory/index.js";

/** Native connection configuration and process lifetime only; no task/session ownership. */
export function registerDeviceBridgeSettings(hosts: Map<number, UtilityProcess>) {
  const directory = join(app.getPath("userData"), "device-bridge");
  const file = join(directory, "settings.json");
  const binary = `device-bridge${process.platform === "win32" ? ".exe" : ""}`;
  const defaultBinary = app.isPackaged
    ? join(process.resourcesPath, "device-bridge", binary)
    : resolve(
        app.getAppPath(),
        "bundled-tools",
        `${process.platform}-${process.arch}`,
        "device-bridge",
        binary,
      );
  const readConfiguration = async (): Promise<DeviceBridgeConfiguration> => {
    try {
      return deviceBridgeConfigurationSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { binaryPath: defaultBinary, allowedNodes: [] };
      throw new Error("device_bridge_configuration_unavailable");
    }
  };
  const controller = createDeviceBridgeController({
    readConfiguration,
    writeConfiguration: async (configuration) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(configuration), { mode: 0o600 });
      await rename(temporary, file);
    },
    startSession: (onExit, configuration) =>
      startDeviceBridgeProcess({
        binaryPath: configuration.binaryPath,
        stateDir: join(directory, "node"),
        hostname: `zcode-${
          hostname()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .slice(0, 40) || "desktop"
        }`,
        onExit,
      }),
    saveMcp: saveCliMcpToUserDirectory,
    checkMcp: checkDeviceBridgeMcp,
    openLogin: async (url) => shell.openExternal(url),
    removeDevice: removeTailscaleDevice,
  });
  const checkSender = (event: Electron.IpcMainInvokeEvent) => {
    if (!hosts.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame)
      throw new Error("device_bridge_untrusted_sender");
  };
  ipcMain.handle(PlatformChannels.GetDeviceBridgeState, (event) => {
    checkSender(event);
    return controller.read();
  });
  ipcMain.handle(PlatformChannels.ExecuteDeviceBridgeCommand, (event, input: unknown) => {
    checkSender(event);
    return controller.execute(deviceBridgeCommandSchema.parse(input));
  });
  app.once("will-quit", () => {
    void controller.dispose().catch(() => {});
  });
  return controller;
}
