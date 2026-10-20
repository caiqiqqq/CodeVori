import type { DatabaseSync } from "node:sqlite";
import type { ZCodeTaskMeta } from "@zcode/shared";

export interface ArchivedTaskPurgeRow {
  archived: number;
  deleted: number;
  meta: ZCodeTaskMeta;
}

/** Repository-owned durable intent, without holding SQLite locks across Agent IO. */
export async function purgeArchivedTaskRecord(
  db: DatabaseSync,
  key: string,
  taskId: string,
  read: () => ArchivedTaskPurgeRow | null,
  removeGrouping: () => void,
  purge: () => Promise<"deleted" | "busy">,
): Promise<ZCodeTaskMeta | null> {
  db.exec("BEGIN IMMEDIATE");
  let meta: ZCodeTaskMeta;
  let alreadyPending = false;
  try {
    const row = read();
    if (!row || row.deleted || !row.archived) {
      db.exec("COMMIT");
      return null;
    }
    alreadyPending = Boolean(row.meta.deletionState);
    meta = { ...row.meta, deletionState: "pending" };
    db.prepare("UPDATE tasks SET meta_json=? WHERE workspace_key=? AND task_id=?").run(
      JSON.stringify(meta),
      key,
      taskId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  // 修复原因：原归档删除只写 tombstone，CLI 正文仍在；先持久化 intent，
  // 即使清理成功后的索引写入失败，重启也只能重试清理，不能把已删内容恢复。
  const result = await purge();
  if (result === "busy") {
    if (alreadyPending) return null;
    delete meta.deletionState;
    db.prepare(
      "UPDATE tasks SET meta_json=? WHERE workspace_key=? AND task_id=? AND deleted=0",
    ).run(JSON.stringify(meta), key, taskId);
    return null;
  }
  const tombstone: ZCodeTaskMeta = {
    taskId,
    traceId: taskId,
    title: "",
    workspacePath: meta.workspacePath,
    ...(meta.workspaceIdentity ? { workspaceIdentity: meta.workspaceIdentity } : {}),
    mode: "build",
    createdAt: 0,
    updatedAt: 0,
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE tasks SET deleted=1, pinned=0, title='', task_status=NULL,
      model=NULL, migration_source=NULL, forked_from_task_id=NULL,
      cron_automation_id=NULL, off_peak_task_id=NULL, unread_at=NULL, last_unread_at=0,
      created_at=0, updated_at=0, title_overridden=0, searchable_text='', meta_json=?
      WHERE workspace_key=? AND task_id=?`).run(JSON.stringify(tombstone), key, taskId);
    removeGrouping();
    db.exec("COMMIT");
    return tombstone;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
