import { Fragment } from "react";
import { GripHorizontal } from "lucide-react";
import type { WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { WORK_TASK_COLUMNS, type WorkTaskColumn } from "@/lib/workTaskBoard.js";
import { workTaskSelectionKey } from "@/store/workTaskNavigationStore.js";
import { workTaskProjectOptions } from "@/lib/workTaskProjectOptions.js";
import { cn } from "@/components/lib/utils.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.js";
import { WorkTaskActions } from "./WorkTaskActions.js";
import { WorkTaskAgent, WorkTaskStatus, useWorkTaskMessages } from "./WorkTaskParts.js";
import { WorkTaskSourceLink } from "./WorkTaskSourceLink.js";

const PANEL_IDS = [...WORK_TASK_COLUMNS];
const COLUMN_MARKERS: Record<WorkTaskColumn, string> = {
  todo: "bg-foreground",
  inProgress: "bg-icon-blue",
  attention: "bg-warning",
  done: "bg-success",
};

interface Props {
  columns: Record<WorkTaskColumn, WorkTask[]>;
  panel: WorkTaskPanel;
  panelForTask?(task: WorkTask): WorkTaskPanel;
  taskKey?(task: WorkTask): string;
  projectOptions?: ReturnType<typeof workTaskProjectOptions>;
  onSelect(id: string): void;
  onEdit(task: WorkTask): void;
  onOpenConversation(task: WorkTask): void;
  onDetails(task: WorkTask): void;
  onComplete(task: WorkTask): void;
  selectedId?: string;
}

export function WorkTaskBoardView({
  columns,
  panel,
  panelForTask,
  taskKey = (task: WorkTask) => task.id,
  projectOptions,
  onSelect,
  onEdit,
  onOpenConversation,
  onDetails,
  onComplete,
  selectedId,
}: Props) {
  const t = useWorkTaskMessages();
  // 组件库以 id 覆盖 data-testid，固定 id 保持看板定位稳定。
  return (
    <ResizablePanelGroup
      id="work-task-board"
      orientation="vertical"
      layoutId="work-tasks-board-vertical-v1"
      panelIds={PANEL_IDS}
      className="min-h-160 min-w-0"
    >
      {WORK_TASK_COLUMNS.map((key, index) => (
        <Fragment key={key}>
          <ResizablePanel id={key} defaultSize="25%" minSize="112px">
            <section className="flex h-full min-h-0 min-w-0 flex-col" data-work-task-column={key}>
              <h3 className="flex min-w-0 shrink-0 items-center gap-2 px-4 py-3 text-ui-base font-medium">
                <span
                  aria-hidden="true"
                  className={cn("h-5 w-1 shrink-0", COLUMN_MARKERS[key])}
                  data-testid="work-task-column-marker"
                />
                <span className="min-w-0 flex-1">{t(`column.${key}`)}</span>
                <span className="text-ui-sm text-foreground-subtlest tabular-nums">
                  {columns[key].length}
                </span>
              </h3>
              {/* 分组独立滚动时，滚动条会单独挤窄卡片；统一预留占位保证各组等宽。 */}
              <div
                className="min-h-0 flex-1 overflow-y-auto px-4 [scrollbar-gutter:stable]"
                data-testid="work-task-column-content"
              >
                {columns[key].length ? (
                  <div className="flex min-w-0 flex-col gap-1 pb-3">
                    {columns[key].map((task) => (
                      <article
                        key={workTaskSelectionKey(task)}
                        data-testid="work-task-card"
                        data-task-id={task.id}
                        data-workspace-key={workTaskSelectionKey(task)}
                        className={cn(
                          "relative flex h-9 min-w-0 items-center gap-1 rounded-md border px-1",
                          taskKey(task) === selectedId
                            ? "border-icon-blue bg-accent hover:bg-accent"
                            : "border-card-border bg-card hover:bg-hover",
                        )}
                        data-selected={taskKey(task) === selectedId}
                      >
                        {/* Zai 主题的选中底色与普通卡片相同；用强调底色、边框和不占位标记明确当前任务，悬停时保持选中。 */}
                        {taskKey(task) === selectedId ? (
                          <span
                            aria-hidden="true"
                            data-testid="work-task-selection-marker"
                            className="pointer-events-none absolute inset-y-1.5 left-0 w-1 rounded-r-sm bg-icon-blue"
                          />
                        ) : null}
                        {/* 多行卡片占用过多空间；固定单行且菜单独立，长正文和错误留在右侧及详情。 */}
                        <button
                          type="button"
                          onClick={() => onSelect(taskKey(task))}
                          aria-label={task.title}
                          aria-pressed={taskKey(task) === selectedId}
                          title={
                            projectOptions ? `${task.title} · ${task.workspacePath}` : task.title
                          }
                          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <WorkTaskAgent task={task} iconOnly />
                          <span
                            data-testid="work-task-card-title"
                            className="min-w-0 flex-1 truncate text-ui-base font-medium"
                          >
                            {task.title}
                          </span>
                          {projectOptions ? (
                            <span
                              data-testid="work-task-card-project"
                              className="max-w-20 truncate text-ui-xs text-foreground-subtle"
                              title={task.workspacePath}
                            >
                              {projectOptions.find(
                                ({ tab }) =>
                                  workTaskSelectionKey({ ...tab, id: task.id }) ===
                                  workTaskSelectionKey(task),
                              )?.label ?? task.workspacePath}
                            </span>
                          ) : null}
                          <WorkTaskStatus task={task} />
                          {task.archived ? (
                            <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                              {t("archived")}
                            </span>
                          ) : null}
                        </button>
                        <WorkTaskSourceLink task={task} compact />
                        <div className="shrink-0">
                          <WorkTaskActions
                            task={task}
                            panel={panelForTask?.(task) ?? panel}
                            menu
                            onOpenConversation={onOpenConversation}
                            onEdit={onEdit}
                            onDetails={onDetails}
                            onComplete={onComplete}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p
                    className="flex h-full min-h-0 items-center justify-center text-ui-sm text-foreground-subtlest"
                    data-testid="work-task-empty"
                  >
                    {t("emptyColumn")}
                  </p>
                )}
              </div>
            </section>
          </ResizablePanel>
          {index < WORK_TASK_COLUMNS.length - 1 ? (
            <ResizableHandle
              aria-label={t("resizeSection", { name: t(`column.${key}`) })}
              title={t("resizeSection", { name: t(`column.${key}`) })}
              className="before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border aria-[orientation=horizontal]:mx-0 aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:translate-y-0 aria-[orientation=horizontal]:[mask-image:none] aria-[orientation=horizontal]:[-webkit-mask-image:none]"
            >
              <span className="relative flex h-3 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground-subtlest group-hover/handle:text-foreground">
                <GripHorizontal aria-hidden="true" className="size-3" />
              </span>
            </ResizableHandle>
          ) : null}
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}
