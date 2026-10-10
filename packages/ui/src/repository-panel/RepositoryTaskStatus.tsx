import { isWorkTaskForgePending, type WorkTask } from "@zcode/shared";
import { useRepositoryMessages } from "./RepositoryParts.js";

export function RepositoryTaskStatus({ task }: { task: WorkTask }) {
  const t = useRepositoryMessages();
  const state =
    task.status === "done" && isWorkTaskForgePending(task)
      ? "syncPending"
      : ["preparing", "running", "queued"].includes(task.status) || task.merge?.phase === "applying"
        ? "processing"
        : task.status;
  return (
    <span data-testid="repository-task-status" data-task-status={task.status}>
      {t(`taskStatus.${state}`)}
    </span>
  );
}
