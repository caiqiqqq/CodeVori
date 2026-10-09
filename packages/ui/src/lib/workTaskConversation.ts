import { workTaskExecutionPath, type AcpAgent, type WorkTask } from "@zcode/shared";

export type WorkTaskConversationBinding =
  | { kind: "api"; workspacePath: string; sessionId: string }
  | { kind: "acp"; workspacePath: string; sessionId: string; agent: AcpAgent };

export function workTaskConversationBinding(
  task: WorkTask,
  mergeConversation = false,
): WorkTaskConversationBinding | null {
  // 待办只使用 Host 已保存的执行目录和会话绑定；远端任务不能回落到本机历史。
  const workspacePath = mergeConversation
    ? task.merge?.worktree?.path
    : workTaskExecutionPath(task);
  const session = mergeConversation ? task.merge?.session : task.session;
  if (!workspacePath || !session || task.workspaceIdentity || task.remoteSessionId) return null;
  const common = { workspacePath, sessionId: session.id };
  if (session.kind === "api" && task.execution.kind === "api") return { ...common, kind: "api" };
  if (session.kind === "acp" && task.execution.kind === "acp")
    return { ...common, kind: "acp", agent: task.execution.agent };
  return null;
}
