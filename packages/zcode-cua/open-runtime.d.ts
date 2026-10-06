import type { CuaPermissionStatusResult } from "./broker.d.ts";

export declare const OPEN_CUA_NATIVE_ENV: "ZCODE_OPEN_CUA_NATIVE";
export declare const OPEN_CUA_PERMISSION_APP_ENV: "ZCODE_OPEN_CUA_PERMISSION_APP_PATH";
export declare const OPEN_CUA_MINIMUM_MACOS_VERSION: "14.0";

export interface OpenComputerUseOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  macOsVersion?: string;
  executable?: string;
  probeScreenCapture?: boolean;
}

export declare function isOpenComputerUseSupported(options?: OpenComputerUseOptions): boolean;
export declare function resolveOpenComputerUseNative(options?: OpenComputerUseOptions): string;
export declare function readOpenComputerUsePermissions(
  options?: OpenComputerUseOptions,
): Promise<CuaPermissionStatusResult>;
export declare function refreshOpenComputerUsePermissions(): Promise<void>;

export interface OpenComputerUseService {
  start(): Promise<void>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal; runtimeScope?: "main" | "subagent" },
  ): Promise<{
    isError?: boolean;
    content: unknown[];
    structuredContent?: Record<string, unknown>;
  }>;
  close(): Promise<void>;
}

export declare function createOpenComputerUseService(
  options?: OpenComputerUseOptions,
): OpenComputerUseService;
export declare const OPEN_COMPUTER_USE_TOOLS: readonly { name: string; inputSchema: unknown }[];
