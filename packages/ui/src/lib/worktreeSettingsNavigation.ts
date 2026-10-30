import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import type { IWorkTaskService } from "@zcode/services";
import type { WorkTaskScope } from "@zcode/shared";

export type WorktreeHistoryConversationTarget =
  | { kind: "api"; workspacePath: string; workspaceIdentity?: string; taskId: string }
  | { kind: "acp"; session: AcpSidebarSession };

export type WorktreeSettingsConversationTarget =
  | WorktreeHistoryConversationTarget
  | { kind: "work-task"; scope: WorkTaskScope; id: string };

export async function resolveWorktreeSettingsConversation(
  service: Pick<IWorkTaskService, "list"> | undefined,
  projectPath: string,
  target: WorktreeHistoryConversationTarget,
): Promise<WorktreeSettingsConversationTarget> {
  if (!service) return target;
  if (target.kind === "api" && target.workspaceIdentity) return target;
  if (target.kind === "acp" && (target.session.workspaceIdentity || target.session.remoteSessionId))
    return target;
  const path = target.kind === "api" ? target.workspacePath : target.session.workspacePath;
  const id = target.kind === "api" ? target.taskId : target.session.id;
  const board = await service.list({ workspacePath: projectPath });
  // 原因：工作树目录只表示执行位置；待办归属必须以 Host 保存的完整绑定为准。
  const owner = board.tasks.find(
    (task) =>
      task.workspacePath === projectPath &&
      !task.workspaceIdentity &&
      !task.remoteSessionId &&
      !task.archived &&
      task.status !== "canceled" &&
      task.worktree?.path === path &&
      task.session?.kind === target.kind &&
      task.session.id === id &&
      task.execution.kind === target.kind &&
      (target.kind !== "acp" ||
        (task.execution.kind === "acp" && task.execution.agent === target.session.agent)),
  );
  return owner
    ? { kind: "work-task", scope: { workspacePath: projectPath }, id: owner.id }
    : target;
}

let pending: WorktreeSettingsConversationTarget | null = null;
const listeners = new Set<(target: WorktreeSettingsConversationTarget) => void>();

/** 设置页只提交一次导航意图；真正的 session 选择仍由当前聊天壳层执行。 */
export function requestWorktreeSettingsConversation(target: WorktreeSettingsConversationTarget) {
  pending = target;
  for (const listener of listeners) listener(target);
}

/** 待办的会话始终回到所属待办；复用现有导航 owner，不创建普通聊天/工作树 tab。 */
export function requestWorkTaskConversation(task: WorkTaskScope & { id: string }) {
  const { workspacePath, workspaceIdentity, remoteSessionId, id } = task;
  requestWorktreeSettingsConversation({
    kind: "work-task",
    scope: { workspacePath, workspaceIdentity, remoteSessionId },
    id,
  });
}

export function listenWorktreeSettingsConversation(
  listener: (target: WorktreeSettingsConversationTarget) => void,
): () => void {
  listeners.add(listener);
  if (pending) listener(pending);
  return () => listeners.delete(listener);
}

export function consumeWorktreeSettingsConversation(target: WorktreeSettingsConversationTarget) {
  if (pending === target) pending = null;
}
