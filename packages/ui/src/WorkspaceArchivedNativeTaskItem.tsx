import { useState } from "react";
import type { IServiceAccessor, WindowHostControllerTaskListItem } from "@zcode/services";
import { ArchiveX, Cloud, CloudDownload, Folder, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getTaskChangeSummary } from "@/lib/taskChangeSummary.js";
import { logger } from "@/logger.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { applyTaskQueryCacheMutation } from "@/store/taskQueryCacheStore.js";
import { removeTaskFromTaskCaches } from "@/lib/taskListMetaSync.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";

export function WorkspaceArchivedNativeTaskItem({
  task,
  services,
  workspaceLabel,
  isActive,
  onSelectTask,
  refresh,
}: {
  task: WindowHostControllerTaskListItem;
  services?: IServiceAccessor;
  workspaceLabel: string;
  isActive: boolean;
  onSelectTask: (workspacePath: string, taskId: string, workspaceIdentity?: string) => void;
  refresh: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const [isDeleting, setDeleting] = useState(false);
  const taskTitle = task.title || intl.formatMessage({ id: "taskList.untitled" });
  const taskChangeSummary = getTaskChangeSummary(task);
  const workspaceKey = buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity);
  const isRemoteTask = Boolean(task.workspaceIdentity?.trim());
  const unarchiveLabel = intl.formatMessage({ id: "taskList.unarchive" });
  const deleteLabel = intl.formatMessage({ id: "taskList.deletePermanently" });
  // archived 平铺列表同样是跨 workspace 视图，选中态要按 workspaceKey 隔离。
  const isMobileActive = false;
  const taskKey = `${workspaceKey}:${task.taskId}`;

  return (
    <li
      key={taskKey}
      data-testid={`archived-native-task-${task.taskId}`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelectTask(task.workspacePath, task.taskId, task.workspaceIdentity);
        }
      }}
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
        <p className="min-w-0 flex-1 truncate text-ui-base text-foreground" title={taskTitle}>
          {taskTitle}
        </p>
      </div>
      <div className="mt-1 flex items-center gap-2 text-ui-base text-foreground-subtle">
        <span className="flex min-w-0 flex-1 items-center gap-1.5" title={task.workspacePath}>
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
            disabled={
              !services ||
              task.sourceAvailability === "offline" ||
              isDeleting ||
              Boolean(task.deletionState)
            }
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!services) return;
              void services.zcodeTaskService
                .unarchiveTask({
                  taskId: task.taskId,
                  workspacePath: task.workspacePath,
                  ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
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
                  logger.error("[WorkspaceArchivedTasksFlatSection] 取消归档 task 失败:", error);
                  toast(intl.formatMessage({ id: "taskList.acpRestoreFailed" }));
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
              disabled={isDeleting || !services || task.sourceAvailability === "offline"}
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
                  if (!services) return;
                  const confirmed = await confirmDialog({
                    title: intl.formatMessage({
                      id: "confirmDialog.archivedTaskDeleteTitle",
                    }),
                    description: intl.formatMessage({
                      id: "confirmDialog.archivedTaskDeleteDescription",
                    }),
                    confirmLabel: deleteLabel,
                    confirmVariant: "destructive",
                  });
                  if (!confirmed) {
                    return;
                  }

                  setDeleting(true);
                  try {
                    const deleted = await services.zcodeTaskService.deleteArchivedTask({
                      taskId: task.taskId,
                      workspacePath: task.workspacePath,
                      ...(task.workspaceIdentity
                        ? { workspaceIdentity: task.workspaceIdentity }
                        : {}),
                    });
                    if (!deleted) {
                      toast(intl.formatMessage({ id: "taskList.archiveDeleteSkipped" }));
                      await refresh();
                      return;
                    }
                    // 删除只发生在归档列表，不能把它当成“取消归档”写回普通列表。
                    // 这里直接从 task caches 移除目标项，避免失效整表 query cache 导致列表闪空。
                    removeTaskFromTaskCaches({
                      workspacePath: task.workspacePath,
                      workspaceIdentity: task.workspaceIdentity,
                      taskId: task.taskId,
                    });
                  } catch (error) {
                    logger.error("[WorkspaceArchivedTasksFlatSection] 删除归档 task 失败:", error);
                    toast(intl.formatMessage({ id: "taskList.archiveDeleteFailed" }));
                    await refresh();
                  } finally {
                    setDeleting(false);
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
}
