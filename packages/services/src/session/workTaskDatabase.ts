import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { resolveWorkspaceKey, workTaskSchema, type WorkTask } from "@zcode/shared";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
export type WorkTaskDatabase = InstanceType<typeof DatabaseSync>;

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
