import { useMemo, useState } from "react";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useArchivedWorkspaceScopes } from "@/hooks/useArchivedWorkspaceScopes.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { removeTaskFromTaskCaches } from "@/lib/taskListMetaSync.js";
import { TaskListRemoteSyncHint } from "@/TaskListRemoteSyncHint.js";
import { TaskListLoadingHint } from "@/TaskListLoadingHint.js";
import { buildWorkspaceServiceLookup } from "@/lib/workspaceServiceResolver.js";
import { DeleteAllArchivedTasksButton } from "@/DeleteAllArchivedTasksButton.js";
import { useAcpSidebarSessions } from "@/hooks/useAcpSidebarSessions.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { WorkspaceArchivedAcpSessionItem } from "@/WorkspaceArchivedAcpSessionItem.js";

import { WorkspaceArchivedProjectGroup } from "@/WorkspaceArchivedProjectGroup.js";
import { WorkspaceArchivedNativeTaskItem } from "@/WorkspaceArchivedNativeTaskItem.js";

export function WorkspaceArchivedTasksFlatSection({
  workspaceTabs,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  activeTaskId,
  activeAcpSessionId,
  sortBy,
  actionsContainer,
  onSelectTask,
  onSelectAcpSession,
}: {
  workspaceTabs: WorkspaceTabState[];
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId: string | null;
  activeAcpSessionId?: string | null;
  sortBy: "created" | "updated";
  actionsContainer?: HTMLElement | null;
  onSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
  ) => void;
  onSelectAcpSession?: (session: AcpSidebarSession) => void;
}) {
  const { intl } = useZCodeIntl();
  const baseServices = useBaseWorkspaceServices();
  const archiveScopes = useArchivedWorkspaceScopes(workspaceTabs);
  const sessionsById = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const sessionIdByWorkspaceIdentity = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspaceIdentity,
  );
  const sessionIdByWorkspacePath = useRemoteWorkspaceSessionStore(
    (state) => state.sessionIdByWorkspacePath,
  );
  const serviceResolverState = useMemo(
    () => ({
      sessionsById,
      sessionIdByWorkspaceIdentity,
      sessionIdByWorkspacePath,
    }),
    [sessionIdByWorkspaceIdentity, sessionIdByWorkspacePath, sessionsById],
  );
  const [showAllTasks, setShowAllTasks] = useState(false);
  const collapsedLimit = 20;
  const workspaceLabelByKey = useMemo(
    () =>
      new Map(
        archiveScopes.map(
          (tab) =>
            [
              buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
              tab.label || getPathLeaf(tab.workspacePath),
            ] as const,
        ),
      ),
    [archiveScopes],
  );

  const workspaceServiceLookup = useMemo(
    () => buildWorkspaceServiceLookup(archiveScopes, baseServices, serviceResolverState),
    [baseServices, serviceResolverState, archiveScopes],
  );
  const acpSessions = useAcpSidebarSessions(archiveScopes, workspaceServiceLookup);
  const activeWorkspaceKey = buildTaskWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity);
  const { items, total, loading, syncingRemoteWorkspaces, refresh } = useGlobalTaskList({
    kind: "archived",
    workspaceTabs: archiveScopes,
    sortBy,
    searchQuery: "",
    expanded: showAllTasks,
    collapsedLimit,
  });
  const archivedAcpSessions = useMemo(
    () => acpSessions.filter((session) => session.archived),
    [acpSessions],
  );
  const displayItems = useMemo(
    () =>
      [
        ...items.map((task) => ({ kind: "native" as const, task })),
        ...archivedAcpSessions.map((session) => ({ kind: "acp" as const, session })),
      ]
        .sort((left, right) => {
          const leftTime =
            left.kind === "acp" ? left.session[`${sortBy}At`] : left.task[`${sortBy}At`];
          const rightTime =
            right.kind === "acp" ? right.session[`${sortBy}At`] : right.task[`${sortBy}At`];
          return rightTime - leftTime;
        })
        .slice(0, showAllTasks ? undefined : collapsedLimit),
    [archivedAcpSessions, items, showAllTasks, sortBy],
  );
  const canToggleExpanded = total + archivedAcpSessions.length > collapsedLimit;
  const workspaceGroups = useMemo(() => {
    type DisplayItem = (typeof displayItems)[number];
    const groups = new Map<string, [DisplayItem, ...DisplayItem[]]>();
    // 项目名和路径都可能重名；沿用 Host 身份 key，避免本地与远程归档混组。
    // displayItems 已按所选时间排序，Map 保留首条出现顺序，也就保留了项目间的时间顺序。
    for (const entry of displayItems) {
      const item = entry.kind === "acp" ? entry.session : entry.task;
      const key = buildTaskWorkspaceKey(item.workspacePath, item.workspaceIdentity);
      if (entry.kind === "acp" && !workspaceServiceLookup.has(key)) continue;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }
    return [...groups];
  }, [displayItems, workspaceServiceLookup]);

  return (
    <div>
      <DeleteAllArchivedTasksButton
        actionsContainer={actionsContainer}
        count={total}
        nativeOnly={archivedAcpSessions.length > 0}
        disabled={loading || total === 0}
        workspaces={archiveScopes.map((tab) => ({
          workspacePath: tab.workspacePath,
          workspaceIdentity: tab.workspaceIdentity,
          label: tab.label || getPathLeaf(tab.workspacePath),
          service: workspaceServiceLookup.get(
            buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
          )?.services.zcodeTaskService,
        }))}
        onDeleted={removeTaskFromTaskCaches}
        onRefresh={refresh}
      />
      {displayItems.length === 0 ? (
        loading ? (
          <TaskListLoadingHint />
        ) : (
          <div className="px-3 py-2 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "taskList.noArchivedTasks" })}
          </div>
        )
      ) : null}
      <div className="space-y-4 pb-4">
        {workspaceGroups.map(([workspaceKey, entries]) => {
          const firstEntry = entries[0];
          const workspace = firstEntry.kind === "acp" ? firstEntry.session : firstEntry.task;
          const label =
            workspaceLabelByKey.get(workspaceKey) ?? getPathLeaf(workspace.workspacePath);
          const isRemote = Boolean(workspace.workspaceIdentity?.trim());
          return (
            <WorkspaceArchivedProjectGroup
              key={workspaceKey}
              workspaceKey={workspaceKey}
              workspacePath={workspace.workspacePath}
              label={label}
              isRemote={isRemote}
              count={entries.length}
            >
              {entries.map((entry) => {
                if (entry.kind === "acp") {
                  const session = entry.session;
                  const key = buildTaskWorkspaceKey(
                    session.workspacePath,
                    session.workspaceIdentity,
                  );
                  const resolved = workspaceServiceLookup.get(key);
                  if (!resolved) return null;
                  return (
                    <WorkspaceArchivedAcpSessionItem
                      key={`acp:${key}:${session.id}`}
                      session={session}
                      service={resolved.services.acpService}
                      workspaceLabel={
                        workspaceLabelByKey.get(key) ?? getPathLeaf(session.workspacePath)
                      }
                      active={key === activeWorkspaceKey && session.id === activeAcpSessionId}
                      onSelect={() => onSelectAcpSession?.(session)}
                    />
                  );
                }
                const task = entry.task;
                const key = buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity);
                return (
                  <WorkspaceArchivedNativeTaskItem
                    key={`${key}:${task.taskId}`}
                    task={task}
                    services={workspaceServiceLookup.get(key)?.services}
                    workspaceLabel={workspaceLabelByKey.get(key) ?? getPathLeaf(task.workspacePath)}
                    isActive={key === activeWorkspaceKey && task.taskId === activeTaskId}
                    onSelectTask={onSelectTask}
                    refresh={refresh}
                  />
                );
              })}
            </WorkspaceArchivedProjectGroup>
          );
        })}
      </div>
      {syncingRemoteWorkspaces ? <TaskListRemoteSyncHint /> : null}
      {canToggleExpanded ? (
        <div className="cursor-pointer pl-8.5 pb-4">
          <span
            className="text-ui-base text-foreground-subtlest hover:text-foreground-subtle"
            onClick={() => {
              setShowAllTasks((current) => !current);
            }}
          >
            {intl.formatMessage({
              id: showAllTasks ? "taskList.showLess" : "taskList.showMore",
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
