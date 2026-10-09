import { useCallback, useEffect, useState } from "react";
import type { GitChangeSourceId, WorkTaskScope } from "@zcode/shared";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceReadOnly, isWorkspaceTab } from "@/store/tabStore.js";
import type { OpenScopedGitReview } from "@/hooks/usePaneGitStatus.js";

interface GitReviewRequest {
  scope: WorkTaskScope;
  sourceId?: GitChangeSourceId;
}

export function useScopedGitReview({
  scope,
  rpcReady,
  readOnly,
  onOpenGitReview,
}: {
  scope: WorkTaskScope;
  rpcReady: boolean;
  readOnly: boolean;
  onOpenGitReview: (sourceId?: GitChangeSourceId) => void;
}): OpenScopedGitReview {
  const tabs = useTabStoreApi();
  const [request, setRequest] = useState<GitReviewRequest | null>(null);
  const openReview = useCallback<OpenScopedGitReview>(
    (target, sourceId) => {
      const state = tabs.getState();
      if (isWorkspaceReadOnly(state, target.workspacePath, target.workspaceIdentity)) return;
      const targetKey = target.workspaceIdentity?.trim() || target.workspacePath;
      // 修复原因：旧回调闭包绑定 Shell 项目，不能直接拿来审查另一个项目。
      // 请求先固定 scope，导航完成后才调用目标项目的现有打开路径；不改写 ACP/native 会话绑定。
      setRequest({ scope: { ...target }, sourceId });
      // 已有 tab 的 attachment 元数据由连接注册表维护，旧 pane 请求不能覆盖重连后的 id。
      const existing = state.tabs.find(
        (tab) =>
          isWorkspaceTab(tab) &&
          tab.workspacePath === target.workspacePath &&
          (tab.workspaceIdentity?.trim() || tab.workspacePath) === targetKey,
      );
      const tabId =
        existing?.id ??
        state.ensureWorkspaceTab(target.workspacePath, {
          workspaceIdentity: target.workspaceIdentity,
          remoteSessionId: target.remoteSessionId,
        });
      tabs.getState().activateTab(tabId);
    },
    [tabs],
  );
  const currentKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  useEffect(() => {
    if (!request) return;
    const target = request.scope;
    const targetKey = target.workspaceIdentity?.trim() || target.workspacePath;
    // 导航到其他项目会撤销未就绪的请求，避免重连或返回旧项目后意外打开审查。
    const active = tabs.getState();
    if ((active.activeWorkspaceIdentity?.trim() || active.activeWorkspacePath) !== targetKey) {
      setRequest((current) => (current === request ? null : current));
      return;
    }
    if (targetKey !== currentKey || target.workspacePath !== scope.workspacePath || !rpcReady)
      return;
    // identity-only 请求可等待 attachment 恢复；带旧 attachment 的请求不能操作新连接。
    if (target.remoteSessionId && target.remoteSessionId !== scope.remoteSessionId) {
      setRequest((current) => (current === request ? null : current));
      return;
    }
    if (!readOnly) onOpenGitReview(request.sourceId);
    setRequest((current) => (current === request ? null : current));
  }, [
    currentKey,
    onOpenGitReview,
    readOnly,
    request,
    rpcReady,
    scope.remoteSessionId,
    scope.workspacePath,
    tabs,
  ]);
  return openReview;
}
