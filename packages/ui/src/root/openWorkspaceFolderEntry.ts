import { logger } from "@/logger.js";

export async function openFolderFromWorkspaceEntry({
  selectDirectory,
  selectDirectories,
  openDirectoryBrowser,
  preferDirectoryBrowser = false,
  onSelectProject,
}: {
  selectDirectory?: () => Promise<string | null>;
  selectDirectories?: () => Promise<string[]>;
  openDirectoryBrowser?: () => void;
  preferDirectoryBrowser?: boolean;
  onSelectProject: (path: string) => Promise<void> | void;
}) {
  if (preferDirectoryBrowser) {
    if (!openDirectoryBrowser) {
      logger.warn("[openWorkspaceFolderEntry] directory browser preferred but unavailable");
      return;
    }
    // Web/server 根节点没有系统目录选择框，继续调用 selectDirectory 只会返回 null。
    // 这里显式切到服务端目录浏览器，确保用户选择的是目标 host 上的路径。
    logger.info("[openWorkspaceFolderEntry] opening service directory browser...");
    openDirectoryBrowser();
    return;
  }

  if (!selectDirectories && !selectDirectory) {
    return;
  }

  logger.info("[openWorkspaceFolderEntry] selecting local directories...");
  try {
    const paths = selectDirectories
      ? await selectDirectories()
      : [await selectDirectory!()].filter((path): path is string => Boolean(path));
    for (const path of new Set(paths.filter(Boolean))) {
      try {
        await onSelectProject(path);
      } catch (error) {
        logger.error("[openWorkspaceFolderEntry] failed to open selected directory:", path, error);
      }
    }
  } catch (err) {
    logger.error("[openWorkspaceFolderEntry] directory selection failed:", err);
  }
}
