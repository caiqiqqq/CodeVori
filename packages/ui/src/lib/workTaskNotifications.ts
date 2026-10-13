import type { TaskNotificationPayload, WorkTask, WorkTaskScope } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/index.js";

export const WORK_TASK_NOTIFICATION_PREFIX = "work-task:";
export type WorkTaskNotificationFact = Pick<
  WorkTask,
  "id" | "status" | "runSeq" | "updatedAt" | "archived" | "stopPending"
>;

export function workTaskNotificationId(scope: WorkTaskScope, id: string, runSeq: number): string {
  return (
    WORK_TASK_NOTIFICATION_PREFIX +
    JSON.stringify([
      scope.workspaceIdentity?.trim() || scope.workspacePath,
      scope.workspacePath,
      scope.remoteSessionId?.trim() || "",
      id,
      runSeq,
    ])
  );
}

export function toWorkTaskNotificationFact(task: WorkTask): WorkTaskNotificationFact {
  const { id, status, runSeq, updatedAt, archived, stopPending } = task;
  return { id, status, runSeq, updatedAt, archived, stopPending };
}

export function getWorkTaskWaitingNotification(
  previous: WorkTaskNotificationFact | undefined,
  task: WorkTask,
  scope: WorkTaskScope,
  formatMessage: IntlInstance["formatMessage"],
): TaskNotificationPayload | null {
  if (
    !previous ||
    previous.id !== task.id ||
    previous.runSeq !== task.runSeq ||
    previous.updatedAt > task.updatedAt ||
    previous.archived ||
    previous.stopPending ||
    !["preparing", "running", "queued"].includes(previous.status) ||
    task.status !== "awaiting_input" ||
    task.archived ||
    task.stopPending
  )
    return null;
  const taskId = workTaskNotificationId(scope, task.id, task.runSeq);
  const title = task.title.trim();
  return {
    taskId,
    status: "elicitation_request",
    // 原因：同一任务解决后可能立即再次等待；平台必须按该次等待边沿而非 task id 去重。
    requestId: JSON.stringify([taskId, task.runSeq, task.updatedAt]),
    title: formatMessage({ id: "notification.taskWaiting" }),
    body: title
      ? formatMessage({ id: "notification.taskWithTitle" }, { title })
      : formatMessage({ id: "notification.taskWaiting" }),
  };
}
