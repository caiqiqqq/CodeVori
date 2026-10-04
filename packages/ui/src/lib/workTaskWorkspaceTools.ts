import type { WorkTask, WorkTaskScope } from "@zcode/shared";
import { workTaskConversationBinding } from "./workTaskConversation.js";

export interface WorkTaskWorkspaceToolTarget extends WorkTaskScope {
  taskId: string;
  nativeSessionId: string | null;
  sidePaneOwnerId: string;
}

export function workTaskWorkspaceToolTarget(task: WorkTask): WorkTaskWorkspaceToolTarget {
  const binding = workTaskConversationBinding(task);
  // 远端待办尚不执行工作树；保存的分配不能把工具路由到本机同名目录。
  const local = !task.workspaceIdentity && !task.remoteSessionId;
  return {
    taskId: task.id,
    workspacePath: local ? (task.worktree?.path ?? task.workspacePath) : task.workspacePath,
    workspaceIdentity: task.workspaceIdentity,
    remoteSessionId: task.remoteSessionId,
    nativeSessionId: binding?.kind === "api" ? binding.sessionId : null,
    sidePaneOwnerId: binding?.sessionId ?? `work-task:${task.id}`,
  };
}
