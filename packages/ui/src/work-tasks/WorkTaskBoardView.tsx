import { Fragment } from "react";
import { GripHorizontal } from "lucide-react";
import type { WorkTask } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { WORK_TASK_COLUMNS, type WorkTaskColumn } from "@/lib/workTaskBoard.js";
import { cn } from "@/components/lib/utils.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.js";
import { WorkTaskActions } from "./WorkTaskActions.js";
import { WorkTaskAgent, WorkTaskStatus, useWorkTaskMessages } from "./WorkTaskParts.js";

const PANEL_IDS = [...WORK_TASK_COLUMNS];
const COLUMN_MARKERS: Record<WorkTaskColumn, string> = {
  todo: "bg-foreground",
  inProgress: "bg-icon-blue",
  attention: "bg-warning",
  done: "bg-success",
};

interface Props {
  columns: Record<WorkTaskColumn, WorkTask[]>;
  panel: ReturnType<typeof useWorkTasks>;
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
              <div
                className="min-h-0 flex-1 overflow-y-auto px-4"
                data-testid="work-task-column-content"
              >
                {columns[key].length ? (
                  <div className="flex min-w-0 flex-col gap-1 pb-3">
                    {columns[key].map((task) => (
                      <article
                        key={task.id}
                        data-testid="work-task-card"
                        data-task-id={task.id}
                        className={cn(
                          "flex h-9 min-w-0 items-center gap-1 rounded-md border border-card-border px-1 hover:bg-hover",
                          task.id === selectedId
                            ? "bg-card-selected border-border-hover"
                            : "bg-card",
                        )}
                        data-selected={task.id === selectedId}
                      >
                        {/* 多行卡片占用过多空间；固定单行且菜单独立，长正文和错误留在右侧及详情。 */}
                        <button
                          type="button"
                          onClick={() => onSelect(task.id)}
                          aria-label={task.title}
                          aria-pressed={task.id === selectedId}
                          title={task.title}
                          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <WorkTaskAgent task={task} iconOnly />
                          <span
                            data-testid="work-task-card-title"
                            className="min-w-0 flex-1 truncate text-ui-base font-medium"
                          >
                            {task.title}
                          </span>
                          <WorkTaskStatus task={task} />
                          {task.archived ? (
                            <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                              {t("archived")}
                            </span>
                          ) : null}
                        </button>
                        <div className="shrink-0">
                          <WorkTaskActions
                            task={task}
                            panel={panel}
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
