import { useEffect, useMemo, useState } from "react";
import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { groupWorktreeProjectTabs } from "@/lib/worktreeProjectGrouping.js";
import { logger } from "@/logger.js";

interface WorktreeRelationsSnapshot {
  gitService: ReturnType<typeof useBaseWorkspaceServices>["gitService"];
  pathsSignature: string;
  infoByPath: Record<string, GitWorkspaceRepositoryInfo>;
}

const EMPTY_REPOSITORY_INFO: Readonly<Record<string, GitWorkspaceRepositoryInfo>> = {};

export function useWorktreeProjectGroupsResolution(tabs: readonly WorkspaceTabState[]) {
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
  const [snapshot, setSnapshot] = useState<WorktreeRelationsSnapshot | null>(null);
  const infoByPath =
    snapshot?.gitService === services.gitService ? snapshot.infoByPath : EMPTY_REPOSITORY_INFO;
  // 工作树关系未确认时不能短暂提供可选条目；加载态由查询身份派生，不另存一份状态。
  const loading =
    localPaths.length > 0 &&
    (snapshot?.gitService !== services.gitService || snapshot.pathsSignature !== pathsSignature);

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
      setSnapshot({ gitService: services.gitService, pathsSignature, infoByPath: next });
    });
    return () => {
      cancelled = true;
    };
  }, [pathsSignature, services.gitService]);

  const groups = useMemo(() => groupWorktreeProjectTabs(tabs, infoByPath), [tabs, infoByPath]);
  return { groups, loading };
}

export function useWorktreeProjectGroups(tabs: readonly WorkspaceTabState[]) {
  return useWorktreeProjectGroupsResolution(tabs).groups;
}
