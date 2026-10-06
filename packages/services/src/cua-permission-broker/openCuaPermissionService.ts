import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import {
  readOpenComputerUsePermissions,
  refreshOpenComputerUsePermissions,
} from "@zcode/zcode-cua/open-runtime";
import type { ICuaPermissionService } from "./cuaPermissionService.js";

interface OpenCuaPermissionServiceOptions {
  serviceAuthorityMode?: string;
  env?: NodeJS.ProcessEnv;
  readPermissions?: typeof readOpenComputerUsePermissions;
  refreshPermissions?: typeof refreshOpenComputerUsePermissions;
}

const LOCAL_ONLY_REASON = "电脑控制仅用于本地桌面工作区。";

export function createOpenCuaPermissionService({
  serviceAuthorityMode,
  env = process.env,
  readPermissions = readOpenComputerUsePermissions,
  refreshPermissions = refreshOpenComputerUsePermissions,
}: OpenCuaPermissionServiceOptions): ICuaPermissionService {
  const isLocal = (identity?: string) =>
    serviceAuthorityMode === "desktop-local" &&
    !(identity?.trim() && isRemoteWorkspaceIdentity(identity.trim()));
  return {
    async getStatus(_workspacePath, workspaceIdentity, options) {
      if (!isLocal(workspaceIdentity)) return { available: false, reason: LOCAL_ONLY_REASON };
      return readPermissions({
        env,
        // 现有 UI 使用 includeFunctionalProbes；漏转该字段会让授权验证永远不执行。
        probeScreenCapture:
          options?.probeScreenCapture !== false &&
          (options?.includeFunctionalProbes === true || options?.probeScreenCapture === true),
      });
    },
    async restartHelper(_workspacePath, workspaceIdentity) {
      if (!isLocal(workspaceIdentity)) return { ok: false, reason: LOCAL_ONLY_REASON };
      try {
        await refreshPermissions();
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
