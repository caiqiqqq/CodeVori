import { isWorkTaskMerging, type WorkTask, type WorkTaskWorktreeInspection } from "@zcode/shared";
import type { WorkTaskRepo } from "../session/workTaskRepo.js";

export function createWorkTaskConversationBranchGuard(
  repo: Pick<WorkTaskRepo, "ready" | "boundConversation">,
  inspect: (task: WorkTask) => Promise<WorkTaskWorktreeInspection>,
) {
  return async (input: {
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    kind: "api" | "acp";
    sessionId: string;
  }) => {
    if (input.workspaceIdentity || input.remoteSessionId) return;
    await repo.ready();
    const task = repo.boundConversation(input.workspacePath, input.kind, input.sessionId);
    if (!task?.worktree) return;
    if (task.archived || isWorkTaskMerging(task) || task.worktreeCleanup?.phase === "running")
      throw new Error("work-task.conversation-unavailable");
    // 修复依据：独立会话入口绕过待办面板；每次真实输入由 Host 按持久绑定校验 Git。
    if ((await inspect(task)).status !== "ready") throw new Error("work-task.worktree-mismatch");
  };
}
