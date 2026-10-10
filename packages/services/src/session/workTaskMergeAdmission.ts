import { isWorkTaskMerging, type WorkTask } from "@zcode/shared";

/** Pure guard called inside the existing repository transaction. */
export function admitWorkTaskMerge(task: WorkTask, owned: boolean, targetBranch: string): boolean {
  if (owned && task.merge && ["applying", "merged"].includes(task.merge.phase))
    throw new Error("work-task.merge-applying");
  if (isWorkTaskMerging(task)) {
    if (task.merge?.targetBranch !== targetBranch) throw new Error("work-task.merge-in-progress");
    return false;
  }
  if (task.completion === "merged" && task.merge?.targetBranch === targetBranch) return false;
  if (task.status !== "review" || task.archived || task.stopPending || owned || !task.worktree)
    throw new Error("work-task.not-reviewable");
  if (task.worktree.branchName === targetBranch) throw new Error("work-task.merge-invalid-target");
  return true;
}
