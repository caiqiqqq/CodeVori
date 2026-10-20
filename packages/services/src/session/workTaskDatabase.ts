import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  isWorkTaskMerging,
  resolveWorkspaceKey,
  uuidv7,
  workTaskSchema,
  workTaskExecutionPath,
  type WorkTask,
  type WorkTaskScope,
  type WorkTaskEvent,
  WORK_TASK_ACTIVE_STATUSES,
} from "@zcode/shared";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
export type WorkTaskDatabase = InstanceType<typeof DatabaseSync>;

export function appendWorkTaskQueue(db: WorkTaskDatabase, id: string) {
  const position = db
    .prepare("SELECT COALESCE(MAX(queue_position),0)+1 AS position FROM work_tasks")
    .get() as { position: number };
  db.prepare("UPDATE work_tasks SET queue_position=? WHERE id=?").run(position.position, id);
}

/** Must run inside the owner's BEGIN IMMEDIATE transaction. */
export function claimNextWorkTask(
  db: WorkTaskDatabase,
  owner: string,
  now: number,
  leaseMs: number,
): WorkTask | null {
  const queued = db
    .prepare(
      "SELECT data FROM work_tasks WHERE status='queued' AND owner IS NULL ORDER BY queue_position,id",
    )
    .all() as { data: string }[];
  for (const row of queued) {
    const task = workTaskSchema.parse(JSON.parse(row.data));
    // 直接执行共用项目目录，不能让两个已认领任务交错切分支；隔离任务仍可并发。
    if (task.useWorktree === false) {
      const owned = db.prepare("SELECT data FROM work_tasks WHERE owner IS NOT NULL").all() as {
        data: string;
      }[];
      if (owned.some((item) => workTaskSchema.parse(JSON.parse(item.data)).useWorktree === false))
        continue;
    }
    if (isWorkTaskMerging(task)) {
      const owned = db.prepare("SELECT data FROM work_tasks WHERE owner IS NOT NULL").all() as {
        data: string;
      }[];
      // 同一仓库可来自不同项目子目录；目标分支锁不能只按 workspace scope 计算。
      if (
        owned.some((item) => {
          const other = workTaskSchema.parse(JSON.parse(item.data));
          return (
            isWorkTaskMerging(other) &&
            other.merge?.projectPath === task.merge?.projectPath &&
            other.merge?.targetBranch === task.merge?.targetBranch
          );
        })
      )
        continue;
    }
    // 旧项目并发值仅兼容读写；独立任务不等待其他任务收口，合并目标锁仍在上方保留。
    return writeWorkTask(
      db,
      {
        ...task,
        runSeq: task.runSeq + 1,
        commandId: uuidv7(),
        status: "preparing",
        ...(isWorkTaskMerging(task)
          ? { merge: { ...task.merge!, phase: "preparing" as const } }
          : {}),
        updatedAt: now,
      },
      "claimed",
      owner,
      now + leaseMs,
    );
  }
  return null;
}

export function listWorkTaskConversations(db: WorkTaskDatabase): WorkTask[] {
  // done 只表示上轮已确认完成，保留监听才能投影原会话后续实际开始的新轮。
  const rows = db
    .prepare(
      "SELECT data FROM work_tasks WHERE status IN ('failed','review','done','preparing','running','awaiting_input')",
    )
    .all() as { data: string }[];
  return rows
    .map((row) => workTaskSchema.parse(JSON.parse(row.data)))
    .filter(
      (task) =>
        !task.archived &&
        !isWorkTaskMerging(task) &&
        !task.workspaceIdentity &&
        !task.remoteSessionId &&
        task.session &&
        workTaskExecutionPath(task),
    );
}

export function recordWorkTaskChange(
  db: WorkTaskDatabase,
  task: WorkTask,
  type: string,
  message?: string,
) {
  db.prepare(
    "INSERT INTO work_task_projects(workspace_key,revision) VALUES (?,1) ON CONFLICT(workspace_key) DO UPDATE SET revision=revision+1",
  ).run(resolveWorkspaceKey(task));
  db.prepare("INSERT INTO work_task_events(task_id,run_seq,at,type,message) VALUES(?,?,?,?,?)").run(
    task.id,
    task.runSeq,
    task.updatedAt,
    type,
    message ?? null,
  );
}

export function writeWorkTask(
  db: WorkTaskDatabase,
  task: WorkTask,
  type: string,
  owner?: string | null,
  leaseUntil?: number | null,
): WorkTask {
  const parsed = workTaskSchema.parse(task);
  if (owner !== undefined) {
    db.prepare("UPDATE work_tasks SET status=?, data=?, owner=?, lease_until=? WHERE id=?").run(
      parsed.status,
      JSON.stringify(parsed),
      owner,
      leaseUntil ?? null,
      parsed.id,
    );
  } else {
    db.prepare("UPDATE work_tasks SET status=?, data=? WHERE id=?").run(
      parsed.status,
      JSON.stringify(parsed),
      parsed.id,
    );
  }
  recordWorkTaskChange(db, parsed, type, parsed.failureReason);
  return parsed;
}

export async function openWorkTaskDatabase(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS work_tasks (
        id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, status TEXT NOT NULL,
        queue_position INTEGER NOT NULL DEFAULT 0, owner TEXT, lease_until INTEGER, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS work_tasks_queue ON work_tasks(status, queue_position);
      CREATE TABLE IF NOT EXISTS work_task_projects (
        workspace_key TEXT PRIMARY KEY, concurrency INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS work_task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
        run_seq INTEGER NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, message TEXT);
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Persisted running/queued execution bindings protect both ordinary and merge conversations. */
export function hasActiveWorkTaskConversation(
  db: WorkTaskDatabase,
  scope: WorkTaskScope,
  session: { kind: "api" | "acp"; id: string },
): boolean {
  const rows = db.prepare("SELECT data FROM work_tasks").all() as { data: string }[];
  return rows
    .map((row) => workTaskSchema.parse(JSON.parse(row.data)))
    .some((task) => {
      if (
        resolveWorkspaceKey({ ...task, workspacePath: scope.workspacePath }) !==
        resolveWorkspaceKey(scope)
      )
        return false;
      const execution =
        workTaskExecutionPath(task) === scope.workspacePath &&
        task.session?.kind === session.kind &&
        task.session.id === session.id;
      const merge =
        task.merge?.worktree?.path === scope.workspacePath &&
        task.merge.session?.kind === session.kind &&
        task.merge.session.id === session.id;
      return (
        (execution || merge) &&
        (task.stopPending ||
          task.status === "queued" ||
          WORK_TASK_ACTIVE_STATUSES.includes(task.status) ||
          isWorkTaskMerging(task))
      );
    });
}

export function listWorkTaskEvents(db: WorkTaskDatabase, id: string): WorkTaskEvent[] {
  const rows = db
    .prepare(
      "SELECT sequence, task_id AS taskId, run_seq AS runSeq, at, type, message FROM work_task_events WHERE task_id=? ORDER BY sequence DESC LIMIT 100",
    )
    .all(id) as unknown as WorkTaskEvent[];
  return rows.reverse();
}
