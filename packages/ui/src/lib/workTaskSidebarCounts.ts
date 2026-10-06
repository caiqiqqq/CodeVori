import type { WorkTask, WorkTaskScope } from "@zcode/shared";
import { columnForWorkTaskStatus } from "./workTaskBoard.js";

export interface WorkTaskCounts {
  running: number;
  waiting: number;
}

export function countWorkTasks(tasks: readonly WorkTask[]): WorkTaskCounts {
  const counts = { running: 0, waiting: 0 };
  for (const task of tasks) {
    if (task.archived) continue;
    const column = columnForWorkTaskStatus(task.status);
    if (column === "inProgress") counts.running++;
    // 等待处理复用看板的 attention 分组，不能只给已完成数量改名。
    if (column === "attention") counts.waiting++;
  }
  return counts;
}

export function workTaskSidebarScopes(
  projects: readonly (WorkTaskScope & { workspacePurpose?: "project" | "conversation" })[],
) {
  const scopes = new Map<string, { key: string; scope: WorkTaskScope }>();
  for (const project of projects) {
    if (project.workspacePurpose === "conversation") continue;
    const workspaceIdentity = project.workspaceIdentity?.trim() || undefined;
    const remoteSessionId = project.remoteSessionId?.trim() || undefined;
    const key = JSON.stringify([remoteSessionId || "", workspaceIdentity || project.workspacePath]);
    if (scopes.has(key)) continue;
    scopes.set(key, {
      key,
      scope: {
        workspacePath: project.workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
      },
    });
  }
  return [...scopes.values()];
}
