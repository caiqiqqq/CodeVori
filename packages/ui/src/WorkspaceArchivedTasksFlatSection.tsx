import { useMemo, useState } from "react";
import { ArchiveX, Cloud, CloudDownload, Folder, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getTaskChangeSummary } from "@/lib/taskChangeSummary.js";
import { getPathLeaf } from "@/lib/path.js";
import { logger } from "@/logger.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { applyTaskQueryCacheMutation } from "@/store/taskQueryCacheStore.js";
import { removeTaskFromTaskCaches } from "@/lib/taskListMetaSync.js";
import { TaskListRemoteSyncHint } from "@/TaskListRemoteSyncHint.js";
import { TaskListLoadingHint } from "@/TaskListLoadingHint.js";
import { buildWorkspaceServiceLookup } from "@/lib/workspaceServiceResolver.js";
import { DeleteAllArchivedTasksButton } from "@/DeleteAllArchivedTasksButton.js";
import { useAcpSidebarSessions } from "@/hooks/useAcpSidebarSessions.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { WorkspaceArchivedAcpSessionItem } from "@/WorkspaceArchivedAcpSessionItem.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";

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
  const confirmDialog = useConfirmDialog();
  const baseServices = useBaseWorkspaceServices();
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
  const [deletingTaskKeys, setDeletingTaskKeys] = useState<Set<string>>(() => new Set());
  const collapsedLimit = 20;
  const workspaceLabelByKey = useMemo(
    () =>
      new Map(
        workspaceTabs.map(
          (tab) =>
            [
              buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
              tab.label || getPathLeaf(tab.workspacePath),
            ] as const,
        ),
      ),
    [workspaceTabs],
  );

  const workspaceServiceLookup = useMemo(
    () => buildWorkspaceServiceLookup(workspaceTabs, baseServices, serviceResolverState),
    [baseServices, serviceResolverState, workspaceTabs],
  );
  const acpSessions = useAcpSidebarSessions(workspaceTabs, workspaceServiceLookup);
  const activeWorkspaceKey = buildTaskWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity);
  const { items, total, loading, syncingRemoteWorkspaces, refresh } = useGlobalTaskList({
    kind: "archived",
    workspaceTabs,
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

  return (
    <div>
      <DeleteAllArchivedTasksButton
        actionsContainer={actionsContainer}
        count={total}
        nativeOnly={archivedAcpSessions.length > 0}
        disabled={loading || total === 0}
        workspaces={workspaceTabs.map((tab) => ({
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
      <ul className="space-y-1 pb-4">
        {displayItems.map((entry) => {
          if (entry.kind === "acp") {
            const session = entry.session;
            const key = buildTaskWorkspaceKey(session.workspacePath, session.workspaceIdentity);
            const resolved = workspaceServiceLookup.get(key);
            if (!resolved) return null;
            return (
              <WorkspaceArchivedAcpSessionItem
                key={`acp:${key}:${session.id}`}
                session={session}
                service={resolved.services.acpService}
                workspaceLabel={workspaceLabelByKey.get(key) ?? getPathLeaf(session.workspacePath)}
                active={key === activeWorkspaceKey && session.id === activeAcpSessionId}
                onSelect={() => onSelectAcpSession?.(session)}
              />
            );
          }
          const task = entry.task;
          const workspaceServices = workspaceServiceLookup.get(
            buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity),
          );
          if (!workspaceServices) {
            return null;
          }
          const { services } = workspaceServices;
          const taskTitle = task.title || intl.formatMessage({ id: "taskList.untitled" });
          const taskChangeSummary = getTaskChangeSummary(task);
          const workspaceKey = buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity);
          const workspaceLabel =
            workspaceLabelByKey.get(workspaceKey) ?? getPathLeaf(task.workspacePath);
          const isRemoteTask = Boolean(task.workspaceIdentity?.trim());
          const unarchiveLabel = intl.formatMessage({ id: "taskList.unarchive" });
          const deleteLabel = intl.formatMessage({ id: "taskList.delete" });
          // archived 平铺列表同样是跨 workspace 视图，选中态要按 workspaceKey 隔离。
          const isActive = workspaceKey === activeWorkspaceKey && task.taskId === activeTaskId;
          const isMobileActive = false;
          const taskKey = `${workspaceKey}:${task.taskId}`;
          const isDeleting = deletingTaskKeys.has(taskKey);

          return (
            <li
              key={taskKey}
              data-mobile-active-task={isMobileActive ? "true" : undefined}
              onClick={() => {
                onSelectTask(task.workspacePath, task.taskId, task.workspaceIdentity);
              }}
              className={cn(
                "cursor-pointer rounded-lg px-2.5 py-2 transition-[background-color,border-color,box-shadow]",
                isActive ? "bg-selected" : "hover:bg-surface-hover",
              )}
            >
              <div className="relative flex items-center gap-2">
                <TaskAgentIcon task={task} />
                {isMobileActive ? (
                  <ControlHintTooltip
                    title={intl.formatMessage({ id: "taskList.mobileActive" })}
                    side="right"
                    align="center"
                    triggerClassName="absolute -left-5 top-1/2 z-10 -translate-y-1/2"
                  >
                    <span
                      data-mobile-active-task="true"
                      className="inline-flex size-4 items-center justify-center rounded-sm text-success"
                      aria-label={intl.formatMessage({
                        id: "taskList.mobileActive",
                      })}
                    >
                      {/* 归档视图也可能保留手机端当前 task 的旧状态，展示同一标记避免列表间状态不一致。
                        上一版把标记放进标题行 flex 流里，会让只有手机标记的 task 标题右移；
                        这里用绝对定位放在标题左侧，让标题文本继续按原始位置对齐。 */}
                      <Smartphone className="size-3.5" />
                    </span>
                  </ControlHintTooltip>
                ) : null}
                <p
                  className="min-w-0 flex-1 truncate text-ui-base text-foreground"
                  title={taskTitle}
                >
                  {taskTitle}
                </p>
              </div>
              <div className="mt-1 flex items-center gap-2 text-ui-base text-foreground-subtle">
                <span
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  title={task.workspacePath}
                >
                  {/* archived 列表以前本地和远端任务都显示 Folder，
                    用户无法判断取消归档会作用在哪一侧。这里用 Cloud 区分远端来源。 */}
                  {isRemoteTask ? (
                    <Cloud className="size-3 shrink-0" />
                  ) : (
                    <Folder className="size-3 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{workspaceLabel}</span>
                </span>
                {taskChangeSummary ? (
                  <span className="shrink-0">
                    {intl.formatMessage(
                      { id: "taskList.changeStats" },
                      {
                        added: String(taskChangeSummary.added),
                        removed: String(taskChangeSummary.removed),
                      },
                    )}
                  </span>
                ) : null}
                <ControlHintTooltip title={unarchiveLabel} side="top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-foreground-subtle hover:text-foreground"
                    aria-label={unarchiveLabel}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void services.zcodeTaskService
                        .unarchiveTask({
                          taskId: task.taskId,
                          workspacePath: task.workspacePath,
                          ...(task.workspaceIdentity
                            ? { workspaceIdentity: task.workspaceIdentity }
                            : {}),
                        })
                        .then((meta) => {
                          applyTaskQueryCacheMutation({
                            previousTask: task,
                            nextTask: meta,
                            previousState: { pinned: false, archived: true },
                            nextState: { pinned: false, archived: false },
                          });
                        })
                        .catch((error) => {
                          logger.error(
                            "[WorkspaceArchivedTasksFlatSection] 取消归档 task 失败:",
                            error,
                          );
                        });
                    }}
                  >
                    {/* 取消归档按钮以前本地/远端都用 ArchiveX，
                      在混合归档列表中看不出操作目标。远端用 CloudDownload 明确会作用到远端 task。 */}
                    {isRemoteTask ? (
                      <CloudDownload className="size-3.5" />
                    ) : (
                      <ArchiveX className="size-3.5" />
                    )}
                  </Button>
                </ControlHintTooltip>
                <ControlHintTooltip title={deleteLabel} side="top">
                  {/* 删除请求期间 button 会 disabled，disabled 元素不产生 hover 事件；
                    用真实 span 承接 tooltip trigger，保持处理中仍能解释该 action。 */}
                  <span className="inline-flex shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={isDeleting}
                      className="shrink-0 text-destructive hover:text-destructive"
                      aria-label={deleteLabel}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void (async () => {
                          const confirmed = await confirmDialog({
                            title: intl.formatMessage({
                              id: "confirmDialog.archivedTaskDeleteTitle",
                            }),
                            description: intl.formatMessage({
                              id: "confirmDialog.archivedTaskDeleteDescription",
                            }),
                            confirmLabel: deleteLabel,
                          });
                          if (!confirmed) {
                            return;
                          }

                          setDeletingTaskKeys((current) => new Set(current).add(taskKey));
                          try {
                            await services.zcodeTaskService.deleteTask({
                              taskId: task.taskId,
                              workspacePath: task.workspacePath,
                              ...(task.workspaceIdentity
                                ? { workspaceIdentity: task.workspaceIdentity }
                                : {}),
                            });
                            // 删除只发生在归档列表，不能把它当成“取消归档”写回普通列表。
                            // 这里直接从 task caches 移除目标项，避免失效整表 query cache 导致列表闪空。
                            removeTaskFromTaskCaches({
                              workspacePath: task.workspacePath,
                              workspaceIdentity: task.workspaceIdentity,
                              taskId: task.taskId,
                            });
                          } catch (error) {
                            logger.error(
                              "[WorkspaceArchivedTasksFlatSection] 删除归档 task 失败:",
                              error,
                            );
                          } finally {
                            setDeletingTaskKeys((current) => {
                              const next = new Set(current);
                              next.delete(taskKey);
                              return next;
                            });
                          }
                        })();
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </ControlHintTooltip>
              </div>
            </li>
          );
        })}
      </ul>
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
