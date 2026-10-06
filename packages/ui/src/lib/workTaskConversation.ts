import type { AcpAgent, WorkTask } from "@zcode/shared";

export type WorkTaskConversationBinding =
  | { kind: "api"; workspacePath: string; sessionId: string }
  | { kind: "acp"; workspacePath: string; sessionId: string; agent: AcpAgent };

export function workTaskConversationBinding(
  task: WorkTask,
  mergeConversation = false,
): WorkTaskConversationBinding | null {
  // 待办只使用 Host 已保存的工作树和会话绑定；远端任务不能回落到本机历史。
  const worktree = mergeConversation ? task.merge?.worktree : task.worktree;
  const session = mergeConversation ? task.merge?.session : task.session;
  if (!worktree || !session || task.workspaceIdentity || task.remoteSessionId) return null;
  const common = { workspacePath: worktree.path, sessionId: session.id };
  if (session.kind === "api" && task.execution.kind === "api") return { ...common, kind: "api" };
  if (session.kind === "acp" && task.execution.kind === "acp")
    return { ...common, kind: "acp", agent: task.execution.agent };
  return null;
}
