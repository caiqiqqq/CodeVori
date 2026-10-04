export function applyWorkspaceTriggerSelection({
  tabId,
  workspacePath,
  isExpanded,
  activateTab,
  toggleWorkspaceExpanded,
}: {
  tabId: string;
  workspacePath: string;
  isExpanded: boolean;
  activateTab: (tabId: string) => void;
  toggleWorkspaceExpanded: (workspacePath: string) => void;
}) {
  activateTab(tabId);

  if (isExpanded) {
    toggleWorkspaceExpanded(workspacePath);
  }
}

/**
 * 展开项目行时，只有当前活动 workspace 不在该项目范围内才应创建新草稿。
 *
 * 活动 workspace 可能是项目本身，也可能是该项目下的工作树；这两种情况
 * 都是在恢复当前会话的可见性，不能被 Collapsible 的展开事件改写成新任务。
 */
export function shouldStartWorkspaceDraftOnExpand({
  isActiveWorkspace,
  hasActiveDescendant,
}: {
  isActiveWorkspace: boolean;
  hasActiveDescendant: boolean;
}): boolean {
  return !isActiveWorkspace && !hasActiveDescendant;
}
