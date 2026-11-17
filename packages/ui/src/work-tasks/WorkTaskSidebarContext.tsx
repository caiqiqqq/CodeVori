import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import type { WorkTask, WorkTaskScope } from "@zcode/shared";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useAgentBoardWorkTasks } from "@/hooks/useAgentBoardWorkTasks.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  workTaskNavigationStore,
  workTaskNavigationKey,
  workTaskSelectionKey,
} from "@/store/workTaskNavigationStore.js";
import { requestWorkTaskConversation } from "@/lib/worktreeSettingsNavigation.js";
import { workTaskBoundConversationKeys } from "@/lib/sidebarConversationRows.js";
import { WorkTaskError } from "./WorkTaskParts.js";

const WorkTaskCreationEditor = lazy(() =>
  import("./WorkTaskCreationEditor.js").then((module) => ({
    default: module.WorkTaskCreationEditor,
  })),
);
const EMPTY_TASKS: readonly WorkTask[] = [];
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const SidebarContext = createContext<{
  tasks: readonly WorkTask[];
  boundKeys: ReadonlySet<string>;
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  refresh?: () => Promise<void>;
  create?: () => void;
}>({ tasks: EMPTY_TASKS, boundKeys: EMPTY_KEYS, selectedKey: null, loading: false, error: null });

export function useWorkTaskSidebar() {
  return useContext(SidebarContext);
}

export function WorkTaskSidebarProvider({
  workspaceTabs,
  active,
  currentScope,
  children,
}: {
  workspaceTabs: WorkspaceTabState[];
  active: boolean;
  currentScope?: WorkTaskScope;
  children: ReactNode;
}) {
  const panel = useAgentBoardWorkTasks(workspaceTabs);
  const [creating, setCreating] = useState(false);
  const navigation = useStore(workTaskNavigationStore);
  const tasks = panel.board?.tasks ?? EMPTY_TASKS;
  const boundKeys = useMemo(() => workTaskBoundConversationKeys(tasks), [tasks]);
  const localProjects = panel.projectTabs.filter(
    (tab) => !tab.workspaceIdentity && !tab.remoteSessionId && !tab.remoteTarget,
  );
  const project =
    localProjects.find(
      (tab) => currentScope && workTaskNavigationKey(tab) === workTaskNavigationKey(currentScope),
    ) ?? localProjects[0];
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
      create: project && panel.executable && !panel.loading ? () => setCreating(true) : undefined,
    }),
    [
      tasks,
      boundKeys,
      selected,
      project,
      panel.loading,
      panel.executable,
      panel.error,
      panel.refresh,
    ],
  );
  return (
    <SidebarContext.Provider value={value}>
      {children}
      {creating && project ? (
        <Suspense fallback={null}>
          <WorkTaskCreationEditor
            scope={project}
            projects={localProjects}
            panel={panel}
            onClose={() => setCreating(false)}
            onCreated={(task) => {
              setCreating(false);
              requestWorkTaskConversation(task);
            }}
          />
        </Suspense>
      ) : null}
    </SidebarContext.Provider>
  );
}

export function WorkTaskSidebarCreateButton() {
  const { intl } = useZCodeIntl();
  const { create, error, refresh } = useWorkTaskSidebar();
  return (
    <>
      <Button
        variant="ghost"
        size="lg"
        className="w-full justify-start gap-2"
        data-testid="work-task-sidebar-create"
        disabled={!create}
        onClick={create}
      >
        <Plus className="size-4" />
        {intl.formatMessage({ id: "workTasks.createTodo" })}
      </Button>
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
