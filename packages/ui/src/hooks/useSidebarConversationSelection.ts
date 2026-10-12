import { useMemo } from "react";
import { usePaneLayoutStore } from "@/v4/paneLayoutStore.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import {
  resolveSidebarConversationSelection,
  type SidebarConversationSelection,
} from "@/lib/sidebarConversationSelection.js";

/** 订阅现有 owner 的稳定引用，不复制当前会话、持久化字段或 Host 状态。 */
export function useSidebarConversationSelection(primary: SidebarConversationSelection) {
  const group = useWorkbenchGroupStore((state) =>
    state.activeGroupId ? (state.groups[state.activeGroupId] ?? null) : null,
  );
  const root = usePaneLayoutStore((state) => state.root);
  const panes = usePaneLayoutStore((state) => state.panes);
  const focusedPaneId = usePaneLayoutStore((state) => state.focusedPaneId);
  const { workspacePath, workspaceIdentity, remoteSessionId, activeTaskId, activeAcpSessionId } =
    primary;
  return useMemo(
    () =>
      resolveSidebarConversationSelection(
        { workspacePath, workspaceIdentity, remoteSessionId, activeTaskId, activeAcpSessionId },
        group,
        { root, panes, focusedPaneId },
      ),
    [
      workspacePath,
      workspaceIdentity,
      remoteSessionId,
      activeTaskId,
      activeAcpSessionId,
      group,
      root,
      panes,
      focusedPaneId,
    ],
  );
}
