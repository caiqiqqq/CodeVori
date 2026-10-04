import { useEffect, useMemo, useState } from "react";
import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { groupWorktreeProjectTabs } from "@/lib/worktreeProjectGrouping.js";
import { logger } from "@/logger.js";

export function useWorktreeProjectGroups(tabs: readonly WorkspaceTabState[]) {
  const services = useBaseWorkspaceServices();
  const localPaths = useMemo(
    () =>
      [
        ...new Set(
          tabs
            .filter((tab) => !tab.workspaceIdentity && !tab.remoteTarget && !tab.remoteSessionId)
            .map((tab) => tab.workspacePath),
        ),
      ].sort(),
    [tabs],
  );
  const pathsSignature = JSON.stringify(localPaths);
  const [infoByPath, setInfoByPath] = useState<Record<string, GitWorkspaceRepositoryInfo>>({});

  useEffect(() => {
    let cancelled = false;
    const paths = JSON.parse(pathsSignature) as string[];
    if (paths.length === 0) return;
    void Promise.all(
      paths.map(async (workspacePath) => {
        try {
          return await services.gitService.getWorkspaceRepositoryInfo({ workspacePath });
        } catch (error) {
          // Git 查询失败不能让已有任务从侧边栏消失；关系缺失时保持独立项目。
          logger.debug("[useWorktreeProjectGroups] 无法解析工作树关系", { workspacePath, error });
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, GitWorkspaceRepositoryInfo> = {};
      for (const info of results) {
        if (info) next[info.workspacePath] = info;
      }
      setInfoByPath(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathsSignature, services.gitService]);

  return useMemo(() => groupWorktreeProjectTabs(tabs, infoByPath), [tabs, infoByPath]);
}
