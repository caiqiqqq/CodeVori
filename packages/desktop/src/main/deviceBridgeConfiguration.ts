import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deviceBridgeConfigurationSchema, type DeviceBridgeConfiguration } from "@zcode/shared";

export function createDeviceBridgeConfigurationStore(directory: string, defaultBinary: string) {
  const file = join(directory, "settings.json");
  const hasSavedNode = async () => {
    try {
      return (await stat(join(directory, "node", "tailscaled.state"))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  return {
    async readConfiguration(): Promise<DeviceBridgeConfiguration> {
      try {
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(file, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          raw = { binaryPath: defaultBinary, allowedNodes: [] };
        }
        const configuration = deviceBridgeConfigurationSchema.parse(raw);
        configuration.binaryPath ||= defaultBinary;
        // 旧版只保存节点凭据，未保存连接意愿；仅迁移缺失字段，显式停止始终优先。
        if (!Object.hasOwn(raw as object, "networkingEnabled"))
          configuration.networkingEnabled = await hasSavedNode();
        return configuration;
      } catch {
        throw new Error("device_bridge_configuration_unavailable");
      }
    },
    async writeConfiguration(configuration: DeviceBridgeConfiguration): Promise<void> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      // 内置组件随安装目录变化；只持久化自定义路径，避免更新后引用旧版本/旧挂载点。
      const binaryPath = configuration.binaryPath === defaultBinary ? "" : configuration.binaryPath;
      await writeFile(temporary, JSON.stringify({ ...configuration, binaryPath }), { mode: 0o600 });
      await rename(temporary, file);
    },
  };
}
