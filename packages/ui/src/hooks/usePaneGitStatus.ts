import { useCallback, useMemo, useState } from "react";
import type { GitChangeSourceId, WorkTaskScope } from "@zcode/shared";
import { useGitRepository } from "@/hooks/useGitRepository.js";
import { useGitAutoRefresh } from "@/hooks/useGitAutoRefresh.js";
import { getGitWorktreeStatus } from "@/lib/gitWorktreeStatus.js";
import { getGitDirtyFileCount } from "@/git-branch-switcher/display.js";

export type OpenScopedGitReview = (scope: WorkTaskScope, sourceId?: GitChangeSourceId) => void;

export function usePaneGitStatus(
  scope: WorkTaskScope,
  enabled: boolean,
  onOpenScopedGitReview?: OpenScopedGitReview,
) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const onRefreshGit = useCallback(() => setRefreshVersion((version) => version + 1), []);
  // 修复原因：跨项目窗格没有 Shell Git 投影；按完整 scope 复用现有读取和迟到响应保护。
  // 同 Shell 项目暂停这条读取路径，继续消费 Shell 已有投影，不随焦点重复查询。
  const gitState = useGitRepository({
    ...scope,
    activeTaskId: null,
    enabled,
    scopeIsExplicit: true,
    refreshToken: refreshVersion,
  });
  useGitAutoRefresh({
    ...scope,
    gitSummary: gitState.summary,
    gitSummaryWorkspaceKey: gitState.workspaceKey,
    enabled,
    scopeIsExplicit: true,
    onRefreshGit,
  });
  const status = useMemo(() => getGitWorktreeStatus(gitState.datasets), [gitState.datasets]);
  const onOpenGitReview = useCallback(
    (sourceId?: GitChangeSourceId) => onOpenScopedGitReview?.(scope, sourceId),
    [onOpenScopedGitReview, scope],
  );
  return {
    gitSummary: gitState.summary,
    gitDirtyFileCount: getGitDirtyFileCount(gitState.datasets),
    gitWorktreeChangeSummary: status.changeSummary,
    gitWorktreeReviewSourceId: status.reviewSourceId,
    onRefreshGit,
    onOpenGitReview: onOpenScopedGitReview ? onOpenGitReview : undefined,
  };
}
