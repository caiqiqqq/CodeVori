import { join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { app, ipcMain, shell, type UtilityProcess } from "electron";
import { deviceBridgeCommandSchema, PlatformChannels } from "@zcode/shared";
import { createDeviceBridgeController } from "./deviceBridgeController.js";
import { createDeviceBridgeConfigurationStore } from "./deviceBridgeConfiguration.js";
import { startDeviceBridgeProcess } from "./deviceBridgeProcess.js";
import { checkDeviceBridgeMcp } from "./deviceBridgeMcpCheck.js";
import {
  createDeviceNodeConnections,
  requestDeviceNodeService,
  validateDeviceNodeServiceUrl,
} from "./deviceNodeConnections.js";
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
  const nodeServiceUrl = validateDeviceNodeServiceUrl(
    process.env.CODEVORI_NODE_SERVICE_URL || "https://aimodetest.cn/device-node",
  );
  const nodeFile = join(directory, "execution-nodes.json");
  const nodes = createDeviceNodeConnections({
    serviceUrl: nodeServiceUrl,
    name: hostname().slice(0, 100),
    async readRecords() {
      let text: string;
      try {
        text = await readFile(nodeFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const value = JSON.parse(text);
      if (value.serviceUrl !== nodeServiceUrl || !Array.isArray(value.records))
        throw new Error("device_bridge_pairing_unavailable");
      return value.records;
    },
    async writeRecords(records) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(nodeFile + ".tmp", JSON.stringify({ serviceUrl: nodeServiceUrl, records }), {
        mode: 0o600,
      });
      await rename(nodeFile + ".tmp", nodeFile);
    },
    request: requestDeviceNodeService,
    checkMcp: (endpoint) => checkDeviceBridgeMcp(endpoint, nodeServiceUrl),
    saveMcp: saveCliMcpToUserDirectory,
  });
  nodes.start();
  const controller = createDeviceBridgeController({
    ...createDeviceBridgeConfigurationStore(directory, defaultBinary),
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
    return controller.read().then(async (state) => ({ ...state, nodes: await nodes.read() }));
  });
  ipcMain.handle(PlatformChannels.ExecuteDeviceBridgeCommand, (event, input: unknown) => {
    checkSender(event);
    const command = deviceBridgeCommandSchema.parse(input);
    if (
      command.action === "node-create" ||
      command.action === "node-remove" ||
      command.action === "node-enable"
    )
      return nodes
        .execute(command)
        .then(async () => ({ ...(await controller.read()), nodes: await nodes.read() }));
    return controller
      .execute(command)
      .then(async (state) => ({ ...state, nodes: await nodes.read() }));
  });
  app.once("will-quit", () => {
    void nodes.dispose().catch(() => {});
    void controller.dispose().catch(() => {});
  });
  // 更新/退出只关闭进程，不撤销节点授权；启动时恢复上次启用的连接，错误由状态页呈现。
  void controller.restore().catch(() => {});
  return controller;
}
