import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  isWorkTaskMerging,
  resolveWorkspaceKey,
  uuidv7,
  workTaskSchema,
  type WorkTask,
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
    const key = resolveWorkspaceKey(task);
    const active = db
      .prepare(
        "SELECT COUNT(*) AS count FROM work_tasks WHERE workspace_key=? AND owner IS NOT NULL",
      )
      .get(key) as { count: number };
    const settings = db
      .prepare("SELECT concurrency FROM work_task_projects WHERE workspace_key=?")
      .get(key) as { concurrency: number } | undefined;
    if (active.count >= (settings?.concurrency ?? 1)) continue;
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
  const rows = db
    .prepare(
      "SELECT data FROM work_tasks WHERE status IN ('failed','review','preparing','running','awaiting_input')",
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
        task.worktree,
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
