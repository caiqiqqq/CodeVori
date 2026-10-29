import { useMemo, type ComponentType, type ReactNode } from "react";
import { useStore } from "zustand";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useWorktreeProjectGroupsResolution } from "@/hooks/useWorktreeProjectGroups.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ContextMenuItem } from "@/components/ui/context-menu.js";
import {
  boardEntityKey,
  boardWorkspaceKey,
  matchesBoardTracking,
  type BoardTrackingTarget,
} from "./agentBoardModel.js";

type MenuItem = ComponentType<{ children: ReactNode; onSelect(): void }>;
export function AgentBoardAddMenuItem({
  target,
  archived = false,
  Item = ContextMenuItem,
}: {
  target: BoardTrackingTarget;
  archived?: boolean;
  Item?: MenuItem;
}) {
  const { intl } = useZCodeIntl();
  const included = useStore(agentBoardStore, (state) =>
    matchesBoardTracking(target, state.tracking),
  );
  if (archived || included) return null;
  return (
    <Item onSelect={() => agentBoardStore.getState().includeItem(target)}>
      {intl.formatMessage({ id: "agentBoard.addToBoard" })}
    </Item>
  );
}

export type BoardConversationMenuTarget = {
  workspacePath: string;
  workspaceIdentity?: string;
  kind: "native" | "acp";
  id: string;
  archived?: boolean;
};

/** 仅随菜单打开挂载，复用看板已确认的工作树关系；不为每一行创建查询。 */
export function AgentBoardConversationMenuItem({
  target,
}: {
  target: BoardConversationMenuTarget;
}) {
  const mode = useStore(agentBoardStore, (state) => state.tracking.mode);
  if (mode === "all" || target.archived) return null;
  return <ScopedConversationMenuItem target={target} />;
}

function ScopedConversationMenuItem({ target }: { target: BoardConversationMenuTarget }) {
  const allTabs = useOptionalTabStore((state) => state.tabs);
  const tabs = useMemo(() => allTabs.filter(isWorkspaceTab), [allTabs]);
  const { resolvedGroups, loading } = useWorktreeProjectGroupsResolution(tabs);
  const scopeKey = boardWorkspaceKey(target);
  const tab = tabs.find((tab) => boardWorkspaceKey(tab) === scopeKey);
  const project = resolvedGroups.find((group) =>
    group.workspaceTabs.some((tab) => boardWorkspaceKey(tab) === scopeKey),
  );
  if (loading) return null;
  return (
    <AgentBoardAddMenuItem
      archived={target.archived}
      target={{
        kind: target.kind,
        key: boardEntityKey(target, target.kind, target.id),
        projectKey: project ? boardWorkspaceKey(project.tab) : scopeKey,
        workspacePurpose: tab?.workspacePurpose,
      }}
    />
  );
}
