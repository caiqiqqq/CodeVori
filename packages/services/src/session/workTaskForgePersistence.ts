import { type WorkTask, type WorkTaskForgeWriteback } from "@zcode/shared";
import { writeWorkTask, type WorkTaskDatabase } from "./workTaskDatabase.js";

/** Called inside the task repository's BEGIN IMMEDIATE transaction. */
export function claimWorkTaskForge(db: WorkTaskDatabase, task: WorkTask, owner: string): WorkTask {
  const state = task.forgeWriteback;
  if (!task.source || !state || task.status !== "done" || state.runSeq !== task.runSeq)
    throw new Error("work-task.forge-stale-request");
  if (state.owner && (state.leaseUntil ?? 0) > Date.now()) throw new Error("work-task.forge-busy");
  return writeWorkTask(
    db,
    {
      ...task,
      forgeWriteback: { ...state, owner, leaseUntil: Date.now() + 30_000 },
      updatedAt: Date.now(),
    },
    "forge-writeback-started",
  );
}
export function writeWorkTaskForge(
  db: WorkTaskDatabase,
  task: WorkTask,
  requestId: string,
  next: WorkTaskForgeWriteback,
  owner?: string,
  event = "forge-writeback",
): WorkTask {
  const current = task.forgeWriteback;
  if (
    !current ||
    current.id !== requestId ||
    task.status !== "done" ||
    task.runSeq !== current.runSeq ||
    (owner && (current.owner !== owner || (current.leaseUntil ?? 0) <= Date.now()))
  )
    throw new Error("work-task.forge-stale-request");
  return writeWorkTask(db, { ...task, forgeWriteback: next, updatedAt: Date.now() }, event);
}
