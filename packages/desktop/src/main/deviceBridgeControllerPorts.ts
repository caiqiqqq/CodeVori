import type {
  DeviceBridgeConfiguration,
  DeviceBridgeErrorCode,
  SaveCliMcpToUserDirectoryRequest,
} from "@zcode/shared";
import type { DeviceBridgeInspectionReader } from "./deviceBridgeInspection.js";
import type { DeviceBridgeSession } from "./deviceBridgeProcess.js";
import type { DeviceBridgeCredentialStore } from "./deviceBridgeCredentials.js";

export type DeviceBridgeEndpoint = { nodeId: string; url: string; token: string };
export interface DeviceBridgeControllerPorts {
  credentials?: DeviceBridgeCredentialStore;
  inspectMcp?: DeviceBridgeInspectionReader<DeviceBridgeEndpoint>;
  readConfiguration(): Promise<DeviceBridgeConfiguration>;
  writeConfiguration(value: DeviceBridgeConfiguration): Promise<void>;
  startSession(
    onExit: (reason?: DeviceBridgeErrorCode) => void,
    configuration: DeviceBridgeConfiguration,
  ): Promise<DeviceBridgeSession>;
  saveMcp(request: SaveCliMcpToUserDirectoryRequest): Promise<void>;
  checkMcp(endpoint: DeviceBridgeEndpoint): Promise<number>;
  openLogin(url: string): Promise<void>;
  removeDevice(apiKey: string, nodeId: string, signal: AbortSignal): Promise<void>;
}
