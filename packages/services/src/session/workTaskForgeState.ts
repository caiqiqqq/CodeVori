import {
  isWorkTaskMerging,
  isWorkTaskForgePending,
  uuidv7,
  workTaskSourceKey,
  type WorkTaskSource,
  type WorkTask,
  type WorkTaskForgeOptions,
  type WorkTaskForgeWriteback,
} from "@zcode/shared";

export function prepareWorkTaskForge(
  task: WorkTask,
  options?: WorkTaskForgeOptions,
): WorkTaskForgeWriteback | undefined {
  if (!options) return undefined;
  if (!task.source) throw new Error("work-task.forge-source-required");
  if (options.closeIssue && task.source.kind !== "issue")
    throw new Error("work-task.forge-close-issue-only");
  return {
    ...options,
    id: uuidv7(),
    runSeq: task.runSeq,
    commentState: options.comment ? "pending" : "skipped",
    closeState: options.closeIssue ? "pending" : "skipped",
  };
}

export function workTaskForgeComment(task: WorkTask): string {
  const request = task.forgeWriteback!;
  const outcome =
    task.completion === "merged"
      ? `Merged locally into ${task.merge?.targetBranch ?? ""}; not pushed. Commit: ${task.merge?.resultCommit ?? ""}.`
      : "Accepted without merging; not committed or pushed by this action.";
  return `ZCode task \`${task.id}\` completed.\n${outcome}\n\n${request.comment}\n\n${workTaskForgeMarker(task)}`;
}
export function workTaskForgeMarker(task: WorkTask): string {
  return `<!-- zcode-task:${task.id}:${task.forgeWriteback!.id} -->`;
}

export function assertWorkTaskSourceAvailable(
  tasks: WorkTask[],
  source?: WorkTaskSource,
  exceptId?: string,
) {
  if (
    source &&
    tasks.some(
      (task) =>
        task.id !== exceptId &&
        task.source &&
        workTaskSourceKey(task.source) === workTaskSourceKey(source) &&
        (!["done", "failed", "canceled"].includes(task.status) ||
          (task.status === "done" && isWorkTaskForgePending(task))),
    )
  )
    throw new Error("work-task.duplicate-source");
}

export function completeWorkTaskForge(task: WorkTask, forge?: WorkTaskForgeOptions): WorkTask {
  if (task.status !== "review" || task.stopPending || isWorkTaskMerging(task))
    throw new Error("work-task.not-reviewable");
  return {
    ...task,
    status: "done",
    completion: "accepted_without_merge",
    forgeWriteback: prepareWorkTaskForge(task, forge),
    updatedAt: Date.now(),
  };
}
