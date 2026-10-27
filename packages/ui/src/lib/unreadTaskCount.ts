import { getTaskUnreadIndicator, getVisibleTaskMetas } from "@/store/zcodeSessionStoreSelectors.js";
import type { WorkspaceZCodeUIState } from "@/store/zcodeSessionStoreTypes.js";

type WorkspaceUnreadState = Pick<
  WorkspaceZCodeUIState,
  "optimisticTaskListByTaskId" | "taskListCache"
> &
  Partial<Pick<WorkspaceZCodeUIState, "taskUnreadByTaskId">>;

export function countAllUnreadTasks(workspaces: Record<string, WorkspaceUnreadState>): number {
  const countedTaskKeys = new Set<string>();
  const visitedWorkspaceStates = new WeakSet<object>();

  for (const [workspaceKey, workspace] of Object.entries(workspaces)) {
    if (visitedWorkspaceStates.has(workspace)) {
      continue;
    }
    visitedWorkspaceStates.add(workspace);
    // 角标复用任务列表的未读判断，避免 meta 尚未到达时漏掉已完成任务。
    const visibleTasks = getVisibleTaskMetas(workspace);
    const visibleTaskIds = new Set<string>();
    for (const task of visibleTasks) {
      visibleTaskIds.add(task.taskId);
      if (!getTaskUnreadIndicator(workspace, task.taskId, task)) {
        continue;
      }
      countedTaskKeys.add(
        `${task.workspaceIdentity?.trim() || task.workspacePath}::${task.taskId}`,
      );
    }

    // 兼容标记可能先于列表 meta 到达；即使已有其他可见任务，也必须计入尚未水合的未读任务。
    // 已在列表里的任务通过上面的同一判断计一次，false 标记不产生角标。
    for (const [taskId, unread] of Object.entries(workspace.taskUnreadByTaskId ?? {})) {
      if (!unread || visibleTaskIds.has(taskId)) continue;
      countedTaskKeys.add(`${workspaceKey}::${taskId}`);
    }
  }

  return countedTaskKeys.size;
}
