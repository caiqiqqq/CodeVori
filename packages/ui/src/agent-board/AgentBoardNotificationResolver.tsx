import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useAgentBoardData } from "@/hooks/useAgentBoardData.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { findNotificationBoardItem } from "@/lib/taskNotificationBoardNavigation.js";
import type { WorktreeSettingsConversationTarget } from "@/lib/worktreeSettingsNavigation.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { BoardItem } from "./agentBoardModel.js";

export function AgentBoardNotificationResolver({
  target,
  workspaceTabs,
  onResolved,
}: {
  target: WorktreeSettingsConversationTarget;
  workspaceTabs: readonly Omit<WorkspaceTabState, "id" | "kind">[];
  onResolved: (target: WorktreeSettingsConversationTarget, item: BoardItem | undefined) => void;
}) {
  const tabs = useMemo(
    () =>
      workspaceTabs.map((tab) => ({
        ...tab,
        kind: "workspace" as const,
        id: tab.workspaceIdentity?.trim() || tab.workspacePath,
      })),
    [workspaceTabs],
  );
  const { items, loading, error } = useAgentBoardData(tabs);
  const { loading: projectLoading } = useWorktreeProjectGroupsResolution(tabs);
  const tracking = useStore(agentBoardStore, (state) => state.tracking);
  const [hasStartedRead, setHasStartedRead] = useState(false);
  useEffect(() => setHasStartedRead(true), []);
  useEffect(() => {
    // ACP 摘要读取在挂载 effect 中才进入 pending；首帧不能把空投影当作缺席。
    if (!hasStartedRead || ((loading || projectLoading) && !error)) return;
    onResolved(target, error ? undefined : findNotificationBoardItem(target, items, tracking));
  }, [target, items, tracking, loading, projectLoading, error, hasStartedRead, onResolved]);
  return null;
}
