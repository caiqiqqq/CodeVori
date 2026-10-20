import type { DatabaseSync } from "node:sqlite";
import type { SessionId } from "@zcode/contracts";

/** Deletes only this session's owned rows; never follows filesystem paths or child sessions. */
export function purgeSession(
  db: DatabaseSync,
  input: { sessionID: SessionId; workspaceID: string; directory: string; checkOnly?: boolean },
): "deleted" | "busy" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT workspace_id,directory FROM session WHERE id=?")
      .get(input.sessionID);
    if (!row) {
      db.exec("COMMIT");
      return "deleted";
    }
    if (
      (row.workspace_id || row.directory) !== input.workspaceID ||
      row.directory !== input.directory
    )
      throw new Error("Session does not belong to this workspace");
    // 修复原因：冷会话也可能有 durable 队列或可续跑工作流；不能仅凭没有 runtime 判定 idle。
    const queued = db
      .prepare("SELECT 1 FROM session_input WHERE session_id=? AND status='admitted' LIMIT 1")
      .get(input.sessionID);
    const workflow = db
      .prepare(
        "SELECT 1 FROM workflow_run WHERE parent_session_id=? AND status IN ('pending','running','paused') LIMIT 1",
      )
      .get(input.sessionID);
    const dynamic = db
      .prepare(
        "SELECT 1 FROM dwf_run WHERE parent_session_id=? AND status IN ('pending','running') LIMIT 1",
      )
      .get(input.sessionID);
    if (queued || workflow || dynamic) {
      db.exec("COMMIT");
      return "busy";
    }
    if (input.checkOnly) {
      db.exec("COMMIT");
      return "deleted";
    }
    db.prepare("DELETE FROM input_history WHERE session_id=?").run(input.sessionID);
    db.prepare("DELETE FROM local_setting WHERE scope='session' AND scope_id=?").run(
      input.sessionID,
    );
    db.prepare("DELETE FROM workflow_run WHERE parent_session_id=?").run(input.sessionID);
    db.prepare("DELETE FROM dwf_run WHERE parent_session_id=?").run(input.sessionID);
    db.prepare("UPDATE session SET parent_id=NULL WHERE parent_id=?").run(input.sessionID);
    // message/part/todo/entry/target/input/usage/link 由现有外键 cascade 同事务清理。
    db.prepare("DELETE FROM session WHERE id=?").run(input.sessionID);
    db.exec("COMMIT");
    return "deleted";
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
