import {
  effectiveFocusedPaneId,
  paneBindingMatchesSession,
  V4_PRIMARY_PANE_ID,
  type PaneLayoutSnapshot,
  type PaneWorkspaceScope,
} from "@/v4/paneLayoutTree.js";
import { selectWorkbenchGroupPaneBinding, type WorkbenchGroup } from "@/v4/workbenchGroupStore.js";

export interface SidebarConversationSelection extends PaneWorkspaceScope {
  readonly activeTaskId: string | null;
  readonly activeAcpSessionId: string | null;
}

/** 只读展示投影：group/layout 继续唯一持有布局与焦点，Shell 持有未绑定主窗格。 */
export function resolveSidebarConversationSelection(
  primary: SidebarConversationSelection,
  group: WorkbenchGroup | null,
  layout: PaneLayoutSnapshot,
): SidebarConversationSelection {
  const focusedPaneId = effectiveFocusedPaneId(group ?? layout);
  const empty = { ...primary, activeTaskId: null, activeAcpSessionId: null };
  if (!group && focusedPaneId === V4_PRIMARY_PANE_ID) {
    const sessionId = primary.activeAcpSessionId ?? primary.activeTaskId;
    const kind = primary.activeAcpSessionId ? "acp" : "native";
    // 临时 secondary 已拥有 Shell 的导航会话时，主窗格实际是草稿，不能再高亮旧会话。
    return sessionId &&
      Object.values(layout.panes).some((binding) =>
        paneBindingMatchesSession(binding, primary, sessionId, kind),
      )
      ? empty
      : primary;
  }
  const binding = group
    ? selectWorkbenchGroupPaneBinding(group, focusedPaneId)
    : layout.panes[focusedPaneId];
  // 关闭主窗格后仍沿用 surviving pane 的真实绑定；只读/待验证/空草稿不借用主会话。
  if (!binding?.sessionId || binding.readOnly || binding.restoredUnvalidated) return empty;
  return {
    ...binding.workspaceScope,
    activeTaskId: binding.kind === "acp" ? null : binding.sessionId,
    activeAcpSessionId: binding.kind === "acp" ? binding.sessionId : null,
  };
}
