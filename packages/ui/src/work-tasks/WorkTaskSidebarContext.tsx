import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";
import type { WorkTask } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useAgentBoardWorkTasks } from "@/hooks/useAgentBoardWorkTasks.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  workTaskNavigationStore,
  workTaskNavigationKey,
  workTaskSelectionKey,
} from "@/store/workTaskNavigationStore.js";
import { workTaskBoundConversationKeys } from "@/lib/sidebarConversationRows.js";
import { WorkTaskError } from "./WorkTaskParts.js";

const EMPTY_TASKS: readonly WorkTask[] = [];
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const SidebarContext = createContext<{
  tasks: readonly WorkTask[];
  boundKeys: ReadonlySet<string>;
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  refresh?: () => Promise<void>;
}>({ tasks: EMPTY_TASKS, boundKeys: EMPTY_KEYS, selectedKey: null, loading: false, error: null });

export function useWorkTaskSidebar() {
  return useContext(SidebarContext);
}

export function WorkTaskSidebarProvider({
  workspaceTabs,
  active,
  children,
}: {
  workspaceTabs: WorkspaceTabState[];
  active: boolean;
  children: ReactNode;
}) {
  const panel = useAgentBoardWorkTasks(workspaceTabs);
  const navigation = useStore(workTaskNavigationStore);
  const tasks = panel.board?.tasks ?? EMPTY_TASKS;
  const boundKeys = useMemo(() => workTaskBoundConversationKeys(tasks), [tasks]);
  const selectedId = navigation.project ? navigation.tasks[navigation.project] : undefined;
  const selected =
    active && selectedId
      ? tasks.find(
          (task) =>
            navigation.tasks[navigation.project!] === task.id &&
            navigation.project === workTaskNavigationKey(task),
        )
      : undefined;
  const value = useMemo(
    () => ({
      tasks,
      boundKeys,
      selectedKey: selected ? workTaskSelectionKey(selected) : null,
      loading: panel.loading,
      error: panel.error,
      refresh: panel.refresh,
    }),
    [tasks, boundKeys, selected, panel.loading, panel.error, panel.refresh],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function WorkTaskSidebarReadError() {
  const { intl } = useZCodeIntl();
  const { error, refresh } = useWorkTaskSidebar();
  return (
    <>
      {error ? (
        <div className="px-3 py-1 text-ui-sm">
          <WorkTaskError error={error} />
          <Button size="sm" variant="ghost" onClick={() => void refresh?.()}>
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        </div>
      ) : null}
    </>
  );
}
