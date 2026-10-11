import { WORK_TASK_ACTIVE_STATUSES, uuidv7, workTaskSchema, type WorkTask } from "@zcode/shared";
import { interruptWorkTaskRun } from "./workTaskRunState.js";
import { writeWorkTask, type WorkTaskDatabase } from "./workTaskDatabase.js";

interface CleanupRow {
  data: string;
  owner: string | null;
  lease_until: number | null;
}
// 由 WorkTaskRepo 的 BEGIN IMMEDIATE 事务调用；JSON 状态与现有 owner/lease 同时写入。
export function beginWorktreeCleanup(
  db: WorkTaskDatabase,
  task: WorkTask,
  owner: string,
  leaseMs: number,
): WorkTask {
  const row = db
    .prepare("SELECT owner,lease_until,data FROM work_tasks WHERE id=?")
    .get(task.id) as unknown as CleanupRow | undefined;
  if (!row) throw new Error("work-task.not-found");
  if (task.worktreeCleanup?.phase === "running") throw new Error("work-task.cleanup-in-progress");
  if (
    task.status !== "done" ||
    task.archived ||
    task.stopPending ||
    !task.worktree ||
    task.useWorktree === false ||
    row.owner ||
    (task.forgeWriteback?.owner && (task.forgeWriteback.leaseUntil ?? 0) > Date.now())
  )
    throw new Error("work-task.not-cleanable");
  return writeWorkTask(
    db,
    { ...task, worktreeCleanup: { id: uuidv7(), phase: "running" }, updatedAt: Date.now() },
    "worktree-cleanup-started",
    owner,
    Date.now() + leaseMs,
  );
}

export function finishWorktreeCleanup(
  db: WorkTaskDatabase,
  task: WorkTask,
  owner: string,
  error?: string,
): boolean {
  const row = db
    .prepare("SELECT owner,lease_until,data FROM work_tasks WHERE id=?")
    .get(task.id) as unknown as CleanupRow | undefined;
  if (!row) throw new Error("work-task.not-found");
  const current = workTaskSchema.parse(JSON.parse(row.data));
  // 修复依据：旧 Host 或旧尝试的迟到结果不能归档已经重新认领或改变状态的任务。
  if (
    row.owner !== owner ||
    (row.lease_until ?? 0) <= Date.now() ||
    current.worktreeCleanup?.id !== task.worktreeCleanup?.id ||
    current.worktreeCleanup?.phase !== "running" ||
    current.status !== "done" ||
    current.stopPending
  )
    return false;
  writeWorkTask(
    db,
    {
      ...current,
      archived: !error,
      worktreeCleanup: error ? { ...current.worktreeCleanup, phase: "failed", error } : undefined,
      updatedAt: Date.now(),
    },
    error ? "worktree-cleanup-failed" : "archived",
    null,
  );
  return true;
}

export function canRenewWorkTaskLease(
  row: { owner: string | null; lease_until: number | null },
  current: WorkTask,
  run: WorkTask,
  owner: string,
  now: number,
): boolean {
  return (
    row.owner === owner &&
    (row.lease_until ?? 0) > now &&
    current.runSeq === run.runSeq &&
    (WORK_TASK_ACTIVE_STATUSES.includes(current.status) ||
      (current.worktreeCleanup?.phase === "running" &&
        current.worktreeCleanup.id === run.worktreeCleanup?.id))
  );
}

/** 原运行/清理共用 task owner 的恢复边界，调用方仍负责事务与通知。 */
export function interruptWorkTaskOwners(db: WorkTaskDatabase, now: number, owner?: string) {
  const rows = (owner
    ? db.prepare("SELECT data,owner,lease_until FROM work_tasks WHERE owner=?").all(owner)
    : db
        .prepare(
          "SELECT data,owner,lease_until FROM work_tasks WHERE owner IS NOT NULL AND lease_until<=?",
        )
        .all(now)) as unknown as CleanupRow[];
  for (const row of rows) {
    const task = workTaskSchema.parse(JSON.parse(row.data));
    writeWorkTask(
      db,
      interruptWorkTaskRun(task, now, !!owner),
      owner ? "host-stopping" : "host-interrupted",
      owner ? undefined : null,
    );
  }
}
