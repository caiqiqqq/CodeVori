import { join, resolve } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { app, ipcMain, shell, safeStorage, type UtilityProcess } from "electron";
import {
  deviceBridgeCommandSchema,
  deviceInspectionRequestSchema,
  deviceInspectionResultSchema,
  PlatformChannels,
} from "@zcode/shared";
import { createDeviceBridgeController } from "./deviceBridgeController.js";
import { createDeviceBridgeConfigurationStore } from "./deviceBridgeConfiguration.js";
import { createDeviceBridgeCredentialStore } from "./deviceBridgeCredentials.js";
import { startDeviceBridgeProcess } from "./deviceBridgeProcess.js";
import { checkDeviceBridgeMcp } from "./deviceBridgeMcpCheck.js";
import { inspectDeviceBridgeMcp } from "./deviceBridgeInspection.js";
import { retireDeviceNodeRelay } from "./deviceNodeLegacy.js";
import { removeTailscaleDevice } from "./deviceBridgeManagement.js";
import { saveCliMcpToUserDirectory } from "./mcpUserDirectory/index.js";

/** Native connection configuration and process lifetime only; no task/session ownership. */
export function registerDeviceBridgeSettings(hosts: Map<number, UtilityProcess>) {
  const directory = join(app.getPath("userData"), "device-bridge");
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
  const nodeFile = join(directory, "execution-nodes.json");
  const migration = retireDeviceNodeRelay({
    async read() {
      try {
        return JSON.parse(await readFile(nodeFile, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    removeMcp: (name) =>
      saveCliMcpToUserDirectory({ action: "delete", source: "zcodeagentmcp", name }),
    removeBindings: () => unlink(nodeFile),
  });
  // 注册拒绝处理器，避免启动恢复前的迁移失败成为未处理拒绝；IPC 仍会返回真实失败。
  void migration.catch(() => {});
  const controller = createDeviceBridgeController({
    ...createDeviceBridgeConfigurationStore(directory, defaultBinary),
    credentials: createDeviceBridgeCredentialStore(directory, {
      isEncryptionAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    }),
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
    inspectMcp: inspectDeviceBridgeMcp,
    openLogin: async (url) => shell.openExternal(url),
    removeDevice: removeTailscaleDevice,
  });
  const checkSender = (event: Electron.IpcMainInvokeEvent) => {
    if (!hosts.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame)
      throw new Error("device_bridge_untrusted_sender");
  };
  ipcMain.handle(PlatformChannels.InspectDeviceBridge, async (event, input: unknown) => {
    checkSender(event);
    const request = deviceInspectionRequestSchema.parse(input);
    await migration;
    return deviceInspectionResultSchema.parse(await controller.inspect(request));
  });
  ipcMain.handle(PlatformChannels.GetDeviceBridgeState, (event) => {
    checkSender(event);
    return migration.then(() => controller.read());
  });
  ipcMain.handle(PlatformChannels.ExecuteDeviceBridgeCommand, (event, input: unknown) => {
    checkSender(event);
    const command = deviceBridgeCommandSchema.parse(input);
    return migration.then(async () => {
      if (command.action === "download-node") {
        const file = `CodeVoriNode-${command.platform}${command.platform.startsWith("win32-") ? ".exe" : ""}`;
        await shell.openExternal(`https://aimodetest.cn/codevori-node/clients/current/${file}`);
        return controller.read();
      }
      return controller.execute(command);
    });
  });
  app.once("will-quit", () => {
    void controller.dispose().catch(() => {});
  });
  // 更新/退出只关闭进程，不撤销节点授权；启动时恢复上次启用的连接，错误由状态页呈现。
  void migration.then(() => controller.restore()).catch(() => {});
  return controller;
}
