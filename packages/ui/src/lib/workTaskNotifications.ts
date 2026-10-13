import {
  workTaskExecutionPath,
  type TaskNotificationPayload,
  type WorkTask,
  type WorkTaskScope,
} from "@zcode/shared";
import type { IntlInstance } from "@/i18n/index.js";
import { columnForWorkTaskStatus } from "./workTaskBoard.js";

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

/** 持久化绑定是唯一归属依据；不能按标题或只按同路径推测会话属于待办。 */
export function isWorkTaskNotificationSession(
  tasks: readonly WorkTask[],
  kind: "api" | "acp",
  id: string,
  workspacePath: string,
): boolean {
  return tasks.some(
    (task) =>
      (task.session?.kind === kind &&
        task.session.id === id &&
        workTaskExecutionPath(task) === workspacePath) ||
      (task.merge?.session?.kind === kind &&
        task.merge.session.id === id &&
        task.merge.worktree?.path === workspacePath),
  );
}

export function getWorkTaskAttentionNotification(
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
    !["preparing", "running", "queued", "awaiting_input"].includes(previous.status) ||
    previous.status === task.status ||
    columnForWorkTaskStatus(task.status) !== "attention" ||
    task.archived ||
    task.stopPending
  )
    return null;
  const taskId = workTaskNotificationId(scope, task.id, task.runSeq);
  const title = task.title.trim();
  // 修复依据：“等你处理”还包含待审阅和失败；主项目会话通知无法覆盖独立工作树任务。
  const messageId =
    task.status === "review"
      ? "notification.taskReview"
      : task.status === "failed"
        ? "notification.error"
        : "notification.taskWaiting";
  return {
    taskId,
    status:
      task.status === "review"
        ? "completed"
        : task.status === "failed"
          ? "failed"
          : "elicitation_request",
    // 原因：同一任务解决后可能立即再次等待；平台必须按该次等待边沿而非 task id 去重。
    requestId: JSON.stringify([taskId, task.runSeq, task.updatedAt]),
    title: formatMessage({ id: messageId }),
    body: title
      ? formatMessage({ id: "notification.taskWithTitle" }, { title })
      : formatMessage({ id: messageId }),
  };
}
