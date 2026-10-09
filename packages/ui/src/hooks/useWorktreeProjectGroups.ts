import { useMemo, useState, useSyncExternalStore } from "react";
import type { GitWorkspaceRepositoryInfo } from "@zcode/shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { groupWorktreeProjectTabs } from "@/lib/worktreeProjectGrouping.js";
import { logger } from "@/logger.js";
import { createSharedServiceRead } from "./sharedServiceRead.js";

type GitService = ReturnType<typeof useBaseWorkspaceServices>["gitService"];
type RepositoryInfo = Record<string, GitWorkspaceRepositoryInfo>;
type RelationsRead = ReturnType<typeof createSharedServiceRead<RepositoryInfo>>;
const reads = new WeakMap<GitService, Map<string, RelationsRead>>();

const EMPTY_REPOSITORY_INFO: Readonly<Record<string, GitWorkspaceRepositoryInfo>> = {};

function getRelationsRead(gitService: GitService, pathsSignature: string): RelationsRead {
  let byPaths = reads.get(gitService);
  if (!byPaths) reads.set(gitService, (byPaths = new Map()));
  let resource = byPaths.get(pathsSignature);
  if (!resource) {
    resource = createSharedServiceRead(async () => {
      const paths = JSON.parse(pathsSignature) as string[];
      const results = await Promise.all(
        paths.map(async (workspacePath) => {
          try {
            return await gitService.getWorkspaceRepositoryInfo({ workspacePath });
          } catch (error) {
            // Git 查询失败保持独立项目；不能猜测同名路径归属或丢掉已有任务。
            logger.debug("[useWorktreeProjectGroups] 无法解析工作树关系", { workspacePath, error });
            return null;
          }
        }),
      );
      const info: RepositoryInfo = {};
      for (const result of results) if (result) info[result.workspacePath] = result;
      return info;
    });
    byPaths.set(pathsSignature, resource);
  }
  return resource;
}

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
  const resource = useMemo(
    () => getRelationsRead(services.gitService, pathsSignature),
    [services.gitService, pathsSignature],
  );
  const snapshot = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  const [retained, setRetained] = useState<{
    service: GitService;
    pathsSignature: string;
    data: RepositoryInfo;
  } | null>(null);
  if (
    snapshot.data &&
    (retained?.data !== snapshot.data || retained.service !== services.gitService)
  ) {
    setRetained({ service: services.gitService, pathsSignature, data: snapshot.data });
  }
  // 新 tab 的 Git 关系未返回时保留已确认投影，避免卸载当前任务和丢失会话草稿。
  const confirmed = snapshot.data
    ? { pathsSignature, data: snapshot.data }
    : retained?.service === services.gitService
      ? retained
      : null;
  const infoByPath = confirmed?.data ?? EMPTY_REPOSITORY_INFO;
  // 工作树关系未确认时不能短暂提供可选条目；加载态由查询身份派生，不另存一份状态。
  const loading = localPaths.length > 0 && snapshot.loading;

  const groups = useMemo(() => groupWorktreeProjectTabs(tabs, infoByPath), [tabs, infoByPath]);
  const resolvedGroups = useMemo(() => {
    if (!loading) return groups;
    const confirmedPaths = new Set<string>(confirmed ? JSON.parse(confirmed.pathsSignature) : []);
    return groupWorktreeProjectTabs(
      tabs.filter(
        (tab) =>
          tab.workspaceIdentity ||
          tab.remoteTarget ||
          tab.remoteSessionId ||
          confirmedPaths.has(tab.workspacePath),
      ),
      infoByPath,
    );
  }, [tabs, groups, loading, confirmed?.pathsSignature, infoByPath]);
  return {
    groups,
    resolvedGroups,
    loading,
    hasResolvedRelations: localPaths.length === 0 || !!confirmed,
  };
}

export function useWorktreeProjectGroups(tabs: readonly WorkspaceTabState[]) {
  return useWorktreeProjectGroupsResolution(tabs).groups;
}
