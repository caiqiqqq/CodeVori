import { useCallback, useEffect, useState } from "react";
import type { GitManagedWorktreeProject } from "@zcode/shared";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import {
  loadManagedWorktreeConversations,
  type ManagedWorktreeConversation,
} from "@/lib/managedWorktreeConversations.js";
import { logger } from "@/logger.js";

export function useManagedWorktrees(root: string | null) {
  const services = useBaseWorkspaceServices();
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    root: string | null;
    projects: GitManagedWorktreeProject[];
    conversations: Record<string, ManagedWorktreeConversation[]>;
    failedPaths: Set<string>;
    error: boolean;
    loading: boolean;
  }>({
    root: null,
    projects: [],
    conversations: {},
    failedPaths: new Set(),
    error: false,
    loading: true,
  });
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let live = true;
    setSnapshot({
      root,
      projects: [],
      conversations: {},
      failedPaths: new Set(),
      error: false,
      loading: Boolean(root),
    });
    if (!root)
      return () => {
        live = false;
      };
    void services.gitService
      .listManagedWorktrees({ worktreeRootPath: root })
      .then(async (projects) => {
        if (!live) return;
        setSnapshot((previous) => ({ ...previous, projects, loading: false }));
        const trees = projects.flatMap((project) => project.worktrees);
        await Promise.all(
          trees.map(async ({ worktreePath }) => {
            try {
              const result = await loadManagedWorktreeConversations(services, worktreePath);
              if (!live) return;
              setSnapshot((previous) => ({
                ...previous,
                conversations: { ...previous.conversations, [worktreePath]: result.conversations },
                failedPaths: result.failed
                  ? new Set(previous.failedPaths).add(worktreePath)
                  : previous.failedPaths,
              }));
            } catch (error) {
              logger.warn("[useManagedWorktrees] 读取工作树会话失败", { worktreePath, error });
              if (live)
                setSnapshot((previous) => ({
                  ...previous,
                  failedPaths: new Set(previous.failedPaths).add(worktreePath),
                }));
            }
          }),
        );
      })
      .catch((error: unknown) => {
        logger.warn("[useManagedWorktrees] 扫描工作树失败", { root, error });
        if (live) setSnapshot((previous) => ({ ...previous, loading: false, error: true }));
      });
    return () => {
      live = false;
    };
  }, [root, version, services]);

  // effect 在绘制后才清理旧查询；根目录切换的这一帧也不能展示旧目录的列表。
  return snapshot.root === root
    ? { ...snapshot, refresh }
    : {
        root,
        projects: [],
        conversations: {},
        failedPaths: new Set<string>(),
        error: false,
        loading: Boolean(root),
        refresh,
      };
}
