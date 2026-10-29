import { useMemo } from "react";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useWorktreeProjectGroupsResolution } from "./useWorktreeProjectGroups.js";
import { useWorkTasks } from "./useWorkTasks.js";

export function useAgentBoardWorkTasks(tabs: WorkspaceTabState[]) {
  const projectTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          tab.workspacePurpose !== "conversation" &&
          tab.availability !== "unavailable-local-directory",
      ),
    [tabs],
  );
  const { resolvedGroups } = useWorktreeProjectGroupsResolution(projectTabs);
  // 关联工作树共用主项目待办仓库；关系确认前不能向临时 cwd 发起另一份查询。
  const scopes = useMemo(
    () => resolvedGroups.filter((group) => !group.isLinkedWorktree).map((group) => group.tab),
    [resolvedGroups],
  );
  return useWorkTasks(scopes[0] ?? { workspacePath: "" }, true, scopes.length > 0, scopes);
}
