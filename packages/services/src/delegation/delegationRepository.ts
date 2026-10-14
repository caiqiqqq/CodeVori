import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  delegationTaskSchema,
  delegationSettingsSchema,
  resolveWorkspaceKey,
  type DelegationParent,
  type DelegationTask,
  type DelegationSettings,
  type WorkTaskScope,
} from "@zcode/shared";
import { DelegationResultCache } from "./delegationResultCache.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
export const parentKey = (p: DelegationParent) =>
  JSON.stringify([resolveWorkspaceKey(p), p.kind, p.sessionId]);
export interface ParentState {
  generation: number;
  suspended: boolean;
}

export class DelegationRepository {
  private database?: InstanceType<typeof DatabaseSync>;
  private opening?: Promise<void>;
  private readonly cache = new DelegationResultCache();
  constructor(private readonly path: string) {}
  async open() {
    this.opening ??= (async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const db = new DatabaseSync(this.path);
      db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS delegations(id TEXT PRIMARY KEY, parent_key TEXT NOT NULL,
          request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(parent_key,request_id));
        CREATE INDEX IF NOT EXISTS delegations_parent ON delegations(parent_key);
        CREATE TABLE IF NOT EXISTS delegation_child_sessions(
          workspace_key TEXT NOT NULL, workspace_path TEXT NOT NULL,
          kind TEXT NOT NULL, session_id TEXT NOT NULL, task_id TEXT NOT NULL,
          PRIMARY KEY(workspace_key,workspace_path,kind,session_id));
        CREATE TABLE IF NOT EXISTS delegation_parents(key TEXT PRIMARY KEY, generation INTEGER NOT NULL, suspended INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS delegation_settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);`);
      this.database = db;
      // 修复原因：旧任务只保存当前 session；启动时把尚可恢复的绑定补进追加式归属表。
      for (const row of db.prepare("SELECT data FROM delegations").all() as { data: string }[]) {
        const task = delegationTaskSchema.parse(JSON.parse(row.data));
        this.bindSession(task);
      }
    })();
    await this.opening;
  }
  transaction<T>(run: () => T): T {
    const db = this.db();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  private db() {
    if (!this.database) throw new Error("delegation.database-unavailable");
    return this.database;
  }
  list(parent?: DelegationParent): DelegationTask[] {
    const rows = (
      parent
        ? this.db()
            // 同毫秒 UUID 不保证顺序，SQLite rowid 保留真实入队次序。
            .prepare("SELECT id,data FROM delegations WHERE parent_key=? ORDER BY rowid")
            .all(parentKey(parent))
        : this.db().prepare("SELECT id,data FROM delegations ORDER BY rowid").all()
    ) as { id: string; data: string }[];
    return rows.map((r) => this.decode(r));
  }
  get(id: string): DelegationTask | undefined {
    const row = this.db().prepare("SELECT id,data FROM delegations WHERE id=?").get(id) as
      | { id: string; data: string }
      | undefined;
    return row ? this.decode(row) : undefined;
  }
  private decode(row: { id: string; data: string }): DelegationTask {
    const task =
      this.cache.get(row.id, row.data) ?? delegationTaskSchema.parse(JSON.parse(row.data));
    if (task.status === "completed") {
      const key = parentKey(task.rootParent);
      // 暂停状态也可能由另一 Host 写入，不能只依赖当前窗口的清理事件。
      if (this.parent(task.rootParent).suspended) this.cache.clearParent(key);
      else this.cache.set(key, task, row.data, this.settings(task.rootParent).completedCacheMaxMb);
    }
    return task;
  }
  put(task: DelegationTask) {
    const parsed = delegationTaskSchema.parse(task);
    this.db()
      .prepare(
        "INSERT INTO delegations(id,parent_key,request_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(task.id, parentKey(task.parent), task.requestId, JSON.stringify(parsed));
    this.bindSession(parsed);
    this.cache.delete(task.id);
  }
  private bindSession(task: DelegationTask) {
    if (!task.session) return;
    const workspacePath = task.worktree?.path ?? task.parent.workspacePath;
    this.db()
      .prepare(
        "INSERT OR IGNORE INTO delegation_child_sessions(workspace_key,workspace_path,kind,session_id,task_id) VALUES(?,?,?,?,?)",
      )
      .run(
        // 修复原因：隔离工作树的会话按工作树路径读取，归属键必须与该读取作用域一致。
        resolveWorkspaceKey({ workspacePath, workspaceIdentity: task.parent.workspaceIdentity }),
        workspacePath,
        task.session.kind,
        task.session.id,
        task.id,
      );
  }
  childSessionIds(scope: WorkTaskScope, kind: "api" | "acp"): string[] {
    const rows = this.db()
      .prepare(
        `SELECT session_id FROM delegation_child_sessions WHERE kind=?
          AND workspace_key=? AND workspace_path=?`,
      )
      .all(kind, resolveWorkspaceKey(scope), scope.workspacePath) as { session_id: string }[];
    return rows.map((row) => row.session_id);
  }
  parent(parent: DelegationParent): ParentState {
    const row = this.db()
      .prepare("SELECT generation,suspended FROM delegation_parents WHERE key=?")
      .get(parentKey(parent)) as { generation: number; suspended: number } | undefined;
    return { generation: row?.generation ?? 0, suspended: !!row?.suspended };
  }
  setParent(parent: DelegationParent, state: ParentState) {
    this.db()
      .prepare(
        "INSERT INTO delegation_parents(key,generation,suspended) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET generation=excluded.generation,suspended=excluded.suspended",
      )
      .run(parentKey(parent), state.generation, Number(state.suspended));
    if (state.suspended) this.cache.clearParent(parentKey(parent));
  }
  settings(scope: WorkTaskScope): DelegationSettings {
    const row = this.db()
      .prepare("SELECT data FROM delegation_settings WHERE key=?")
      .get(resolveWorkspaceKey(scope)) as { data: string } | undefined;
    const fallback =
      row ??
      (this.db().prepare("SELECT data FROM delegation_settings WHERE key='__global__'").get() as
        | { data: string }
        | undefined);
    return delegationSettingsSchema.parse(fallback ? JSON.parse(fallback.data) : {});
  }
  setSettings(scope: WorkTaskScope, settings: DelegationSettings) {
    this.db()
      .prepare(
        "INSERT INTO delegation_settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(resolveWorkspaceKey(scope), JSON.stringify(delegationSettingsSchema.parse(settings)));
    this.cache.clear();
  }
  close() {
    this.cache.clear();
    this.database?.close();
    this.database = undefined;
  }
}
