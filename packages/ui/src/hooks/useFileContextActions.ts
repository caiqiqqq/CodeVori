import { useCallback } from "react";
import type { OpenInEditorRemoteTarget } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

interface FileContextActionOptions {
  canOpenLocalFileManager?: boolean;
  isRemoteWorkspace?: boolean;
  remoteTarget?: OpenInEditorRemoteTarget;
  workspaceIdentity?: string;
  openFailedMessage?: string;
}

interface FileContextActionTarget {
  path: string;
  relativePath?: string;
  deleted?: boolean;
  kind?: "file" | "directory";
}

export function useFileContextActions(options: FileContextActionOptions = {}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const canOpenLocalFileManager = Boolean(options.canOpenLocalFileManager);
  const isRemoteWorkspace = Boolean(options.isRemoteWorkspace);
  const remoteTarget = options.remoteTarget;
  const workspaceIdentity = options.workspaceIdentity;
  const openFailedMessage =
    options.openFailedMessage ?? intl.formatMessage({ id: "appHeader.openInFileManagerFailed" });

  const canRevealInFileManager = useCallback(
    (target: FileContextActionTarget) =>
      canOpenLocalFileManager &&
      !target.deleted &&
      (!isRemoteWorkspace || remoteTarget?.kind === "wsl"),
    [canOpenLocalFileManager, isRemoteWorkspace, remoteTarget?.kind],
  );

  const copyPathText = useCallback(async (path: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      logger.warn("[FileContextActions] 复制文件路径失败", {
        path,
        error: "clipboard-unavailable",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      logger.info("[FileContextActions] 文件路径已复制", { path });
    } catch (error) {
      logger.warn("[FileContextActions] 复制文件路径失败", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);
  const copyPath = useCallback(
    (target: FileContextActionTarget) => copyPathText(target.path),
    [copyPathText],
  );
  const copyAbsolutePath = copyPath;
  const copyRelativePath = useCallback(
    (target: FileContextActionTarget) => copyPathText(target.relativePath ?? target.path),
    [copyPathText],
  );

  const revealInFileManager = useCallback(
    async (target: FileContextActionTarget) => {
      if (!canRevealInFileManager(target)) {
        return;
      }

      // 保留文件路径交由平台定位并选中，不能先丢弃文件名只打开父目录。
      const openPath = target.path;
      // 审查区过去把所有远程工作区统一禁用；如果直接放开，又会把 WSL 的
      // Linux 路径交给本机文件管理器。只有精确解析到 WSL target 时才走 Explorer，
      // 保留文件/目录类型，由 main 在平台边界转换为 UNC 并定位文件。
      const result = await (
        remoteTarget?.kind === "wsl"
          ? platform.openInEditor("explorer", openPath, {
              pathKind: target.kind ?? "file",
              remoteTarget,
              workspaceIdentity,
            })
          : platform.openInFileManager(openPath)
      ).catch((error: unknown) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      if (result.success) {
        return;
      }
      logger.warn("[FileContextActions] 在文件管理器中显示条目失败", {
        path: target.path,
        openPath,
        error: result.error ?? "unknown-error",
      });
      toast(openFailedMessage);
    },
    [canRevealInFileManager, openFailedMessage, platform, remoteTarget, workspaceIdentity],
  );

  return {
    canRevealInFileManager,
    copyAbsolutePath,
    copyPath,
    copyRelativePath,
    revealInFileManager,
  };
}
