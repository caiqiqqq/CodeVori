import { isWorkTaskForgePending, type WorkTask } from "@zcode/shared";
import { useRepositoryMessages } from "./RepositoryParts.js";

function repositoryTaskState(task: WorkTask) {
  return task.status === "done" && isWorkTaskForgePending(task)
    ? "syncPending"
    : ["preparing", "running", "queued"].includes(task.status) || task.merge?.phase === "applying"
      ? "processing"
      : task.status;
}

export function repositoryTaskStatusColor(task: WorkTask): string {
  // 议题按钮曾按“已创建”统一染绿；颜色必须跟随现有任务状态投影，列表和详情共用。
  switch (repositoryTaskState(task)) {
    case "processing":
    case "syncPending":
      return "text-warning hover:text-warning";
    case "awaiting_input":
      return "text-interaction-confirmation-foreground hover:text-interaction-confirmation-foreground";
    case "review":
      return "text-icon-blue hover:text-icon-blue";
    case "done":
      return "text-success hover:text-success";
    case "failed":
      return "text-destructive hover:text-destructive";
    default:
      return "text-foreground-subtle hover:text-foreground-subtle";
  }
}

export function RepositoryTaskStatus({ task }: { task: WorkTask }) {
  const t = useRepositoryMessages();
  return (
    <span
      data-testid="repository-task-status"
      data-task-status={task.status}
      className={repositoryTaskStatusColor(task)}
    >
      {t(`taskStatus.${repositoryTaskState(task)}`)}
    </span>
  );
}
