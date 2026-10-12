import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { resolveWorktreeRootPath } from "@/lib/worktree.js";
import {
  isWorktreeDraftSelectionActive,
  type WorktreeDraftSelection,
} from "@/v4/composer/worktreeDraftIntent.js";

export function useWorktreeDraftSelection(options: {
  workspacePath: string;
  workspaceIdentity?: string;
  draftFocusVersion: number;
  sessionId: string | null;
}) {
  const { workspacePath, workspaceIdentity, draftFocusVersion, sessionId } = options;
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const services = useServices();
  const [selection, setSelection] = useState<WorktreeDraftSelection | null>(null);
  const [creating, setCreating] = useState(false);
  const busy = useRef(false);
  const current = useRef({ workspaceKey, workspacePath, draftFocusVersion, sessionId, services });
  if (
    current.current.workspaceKey !== workspaceKey ||
    current.current.workspacePath !== workspacePath ||
    current.current.draftFocusVersion !== draftFocusVersion ||
    current.current.sessionId !== sessionId ||
    current.current.services !== services
  ) {
    // 用作用域对象作代次：离开后再返回相同目录，也不能恢复旧异步请求的创建权限。
    current.current = { workspaceKey, workspacePath, draftFocusVersion, sessionId, services };
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSelection(null);
  }, [workspaceKey, draftFocusVersion, sessionId, services]);
  const selected =
    !workspaceIdentity?.trim() &&
    isWorktreeDraftSelectionActive(selection, workspaceKey, draftFocusVersion, sessionId);
  const sourceBranchName = selected ? (selection?.sourceBranchName ?? null) : null;
  const select = useCallback(
    (next: boolean, source?: string) => {
      if (busy.current) return;
      if (!next) {
        setSelection(null);
        return;
      }
      if (workspaceIdentity?.trim() || sessionId !== null || !source?.trim()) return;
      setSelection({ workspaceKey, draftFocusVersion, sourceBranchName: source.trim() });
    },
    [workspaceKey, workspaceIdentity, draftFocusVersion, sessionId],
  );
  const createWorktree = useCallback(async () => {
    const owner = current.current;
    const isCurrent = () =>
      mounted.current &&
      current.current === owner &&
      owner.sessionId === null &&
      owner.services === services;
    if (
      !selected ||
      !sourceBranchName ||
      busy.current ||
      owner.workspaceKey !== workspaceKey ||
      owner.workspacePath !== workspacePath ||
      owner.draftFocusVersion !== draftFocusVersion ||
      !isCurrent()
    )
      throw new Error("stale-worktree-selection");
    busy.current = true;
    setCreating(true);
    try {
      const [settings, systemInfo] = await Promise.all([
        services.settingService.get(),
        services.systemService.info(),
      ]);
      // 选择是草稿意图：设置读取期间切目录/草稿/Host，不得在已离开的来源目录创建。
      if (!isCurrent()) throw new Error("stale-worktree-selection");
      const worktreeRootPath = resolveWorktreeRootPath({
        configuredRoot: settings.worktreeRootDirectory,
        homeDirectory: systemInfo.homedir,
        workspacePath,
      });
      if (!worktreeRootPath) throw new Error("invalid-worktree-root");
      return await services.gitService.createAutomaticWorktree({
        workspacePath,
        worktreeRootPath,
        sourceBranchName,
      });
    } finally {
      busy.current = false;
      if (mounted.current) setCreating(false);
    }
  }, [selected, sourceBranchName, workspacePath, workspaceKey, draftFocusVersion, services]);
  return { selected, sourceBranchName, creating, select, createWorktree };
}
