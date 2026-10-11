import {
  PRODUCT_NAME,
  isWorkTaskMerging,
  isWorkTaskForgePending,
  uuidv7,
  workTaskSourceKey,
  type WorkTaskSource,
  type WorkTask,
  type WorkTaskForgeOptions,
  type WorkTaskForgeWriteback,
  type WorkTaskChangeRecord,
} from "@zcode/shared";

export function prepareWorkTaskForge(
  task: WorkTask,
  options?: WorkTaskForgeOptions,
  records?: WorkTaskChangeRecord,
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
    ...(records ? { records, recordsFinalized: !isWorkTaskMerging(task) } : {}),
  };
}

export function workTaskForgeComment(task: WorkTask): string {
  const request = task.forgeWriteback!;
  const outcome =
    task.completion === "merged"
      ? `Merged locally into ${task.merge?.targetBranch ?? ""}; not pushed. Commit: ${task.merge?.resultCommit ?? ""}.`
      : "Accepted without merging; not committed or pushed by this action.";
  // 评论展示复用统一品牌名，避免旧名称残留；隐藏幂等标记仍兼容历史回执。
  return `${PRODUCT_NAME} task \`${task.id}\` completed.\n${outcome}\n\n${request.comment}\n\n${formatWorkTaskRecords(request.records)}\n\n${workTaskForgeMarker(task)}`;
}
function formatWorkTaskRecords(records?: WorkTaskChangeRecord): string {
  if (!records || records.state === "unknown")
    return "Change records: unavailable; changes could not be verified.";
  const code = (value: string) => `\`${value.replace(/[\r\n`]/g, " ")}\``;
  const commits = records.commits.map(
    (c) =>
      `- ${c.published && c.url ? `[${c.hash.slice(0, 8)}](${c.url})` : code(c.hash)} ${c.subject} (${c.published ? "published" : "remote publication not confirmed"})`,
  );
  const files = records.files.map(
    (f) => `- ${code(f.path)} ${f.added === null ? "binary" : `+${f.added}/-${f.removed}`}`,
  );
  const pending = records.uncommitted.map((f) => `- ${code(f.path)} (uncommitted)`);
  return [
    "Change records",
    records.branchName ? `Branch: ${code(records.branchName)}` : "",
    records.state === "partial"
      ? "Historical task base unavailable; only current pending edits verified."
      : "",
    ...commits,
    ...files,
    ...pending,
    !commits.length && !files.length && !pending.length && records.state === "known"
      ? "No task changes found."
      : "",
    records.truncated ? "Additional records omitted." : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3800);
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

export function completeWorkTaskForge(
  task: WorkTask,
  forge?: WorkTaskForgeOptions,
  records?: WorkTaskChangeRecord,
): WorkTask {
  if (task.status !== "review" || task.stopPending || isWorkTaskMerging(task))
    throw new Error("work-task.not-reviewable");
  return {
    ...task,
    status: "done",
    completion: "accepted_without_merge",
    forgeWriteback: prepareWorkTaskForge(task, forge, records),
    updatedAt: Date.now(),
  };
}
