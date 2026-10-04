import type { WorkTask, WorkTaskScope } from "@zcode/shared";
import { columnForWorkTaskStatus } from "./workTaskBoard.js";

export interface WorkTaskCounts {
  running: number;
  done: number;
}

export function countWorkTasks(tasks: readonly WorkTask[]): WorkTaskCounts {
  const counts = { running: 0, done: 0 };
  for (const task of tasks) {
    if (task.archived) continue;
    if (columnForWorkTaskStatus(task.status) === "inProgress") counts.running++;
    if (task.status === "done") counts.done++;
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
