import {
  isWorkTaskForgePending,
  isWorkTaskMerging,
  type WorkTask,
  type WorkTaskStatus,
} from "@zcode/shared";

export function canCompleteWorkTask(task: WorkTask): boolean {
  return (
    task.status === "review" && !task.archived && !task.stopPending && !isWorkTaskMerging(task)
  );
}

export function canReviewWorkTaskCompletion(task: WorkTask): boolean {
  return (
    canCompleteWorkTask(task) ||
    (task.status === "done" && !task.stopPending && isWorkTaskForgePending(task))
  );
}

export function canMergeWorkTask(task: WorkTask, executable: boolean): boolean {
  return executable && canCompleteWorkTask(task) && !!task.worktree;
}

export const WORK_TASK_COLUMNS = ["todo", "inProgress", "attention", "done"] as const;
export type WorkTaskColumn = (typeof WORK_TASK_COLUMNS)[number];
export function columnForWorkTaskStatus(status: WorkTaskStatus): WorkTaskColumn {
  switch (status) {
    case "todo":
    case "queued":
      return "todo";
    case "preparing":
    case "running":
      return "inProgress";
    case "awaiting_input":
    case "review":
    case "failed":
      return "attention";
    case "done":
    case "canceled":
      return "done";
  }
}
export function columnForWorkTask(task: Pick<WorkTask, "status" | "merge">): WorkTaskColumn {
  // 合并排队属于交付处理中，不应把已执行完成的任务重新显示到待办。
  return task.status === "queued" && isWorkTaskMerging(task)
    ? "inProgress"
    : columnForWorkTaskStatus(task.status);
}
export function filterWorkTasks(
  tasks: readonly WorkTask[],
  filters: {
    column?: WorkTaskColumn;
    showCanceled?: boolean;
    includeArchived?: boolean;
    search?: string;
  },
) {
  const search = filters.search?.trim().toLocaleLowerCase();
  return tasks
    .filter(
      (task) =>
        (filters.showCanceled || task.status !== "canceled") &&
        (filters.includeArchived || !task.archived) &&
        (!filters.column || columnForWorkTask(task) === filters.column) &&
        (!search || `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(search)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function groupWorkTasksByColumn(
  tasks: readonly WorkTask[],
): Record<WorkTaskColumn, WorkTask[]> {
  const columns: Record<WorkTaskColumn, WorkTask[]> = {
    todo: [],
    inProgress: [],
    attention: [],
    done: [],
  };
  for (const task of tasks) columns[columnForWorkTask(task)].push(task);
  return columns;
}

export function workTaskErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
