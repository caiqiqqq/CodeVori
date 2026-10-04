import type { AcpAgent, WorkTask } from "@zcode/shared";

export type WorkTaskConversationBinding =
  | { kind: "api"; workspacePath: string; sessionId: string }
  | { kind: "acp"; workspacePath: string; sessionId: string; agent: AcpAgent };

export function workTaskConversationBinding(task: WorkTask): WorkTaskConversationBinding | null {
  // 待办只使用 Host 已保存的工作树和会话绑定；远端任务不能回落到本机历史。
  if (!task.worktree || !task.session || task.workspaceIdentity || task.remoteSessionId)
    return null;
  const common = { workspacePath: task.worktree.path, sessionId: task.session.id };
  if (task.session.kind === "api" && task.execution.kind === "api")
    return { ...common, kind: "api" };
  if (task.session.kind === "acp" && task.execution.kind === "acp")
    return { ...common, kind: "acp", agent: task.execution.agent };
  return null;
}
