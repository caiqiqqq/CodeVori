import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { projectEnvironmentSchema, type ProjectEnvironment } from "@zcode/shared";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type Database = InstanceType<typeof DatabaseSync>;
interface Binding {
  revision: number;
  environmentId: string | null;
  environmentRevision: number | null;
}

/** 只存非秘密档案与引用，与现有凭证共用 Host 元数据数据库。 */
export class ProjectEnvironmentRepository {
  private database: Database | undefined;
  private opening: Promise<Database> | undefined;
  constructor(private readonly path: string) {}
  async ready(): Promise<Database> {
    if (this.database) return this.database;
    this.opening ??= (async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const database = new DatabaseSync(this.path);
      database.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS project_environments (
          id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_environment_sessions (
          session_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL
        );`);
      this.database = database;
      return database;
    })();
    return this.opening;
  }
  list(key?: string): ProjectEnvironment[] {
    const database = this.database!;
    const rows = (
      key
        ? database
            .prepare("SELECT data FROM project_environments WHERE workspace_key=? ORDER BY id")
            .all(key)
        : database.prepare("SELECT data FROM project_environments ORDER BY id").all()
    ) as Array<{ data: string }>;
    return rows.map(({ data }) => projectEnvironmentSchema.parse(JSON.parse(data)));
  }
  find(id: string): ProjectEnvironment | null {
    const row = this.database!.prepare("SELECT data FROM project_environments WHERE id=?").get(
      id,
    ) as { data: string } | undefined;
    return row ? projectEnvironmentSchema.parse(JSON.parse(row.data)) : null;
  }
  save(profile: ProjectEnvironment, key: string, expectedRevision: number): void {
    const database = this.database!;
    if (expectedRevision === 0) {
      const result = database
        .prepare(
          "INSERT OR IGNORE INTO project_environments(id,workspace_key,revision,data) VALUES(?,?,?,?)",
        )
        .run(profile.id, key, profile.revision, JSON.stringify(profile));
      if (!result.changes) throw new Error("environment.conflict");
    } else {
      const result = database
        .prepare(
          "UPDATE project_environments SET revision=?,data=? WHERE id=? AND workspace_key=? AND revision=?",
        )
        .run(profile.revision, JSON.stringify(profile), profile.id, key, expectedRevision);
      if (!result.changes) throw new Error("environment.conflict");
    }
  }
  remove(id: string, workspaceKey: string, expectedRevision: number): void {
    const result = this.database!.prepare(
      "DELETE FROM project_environments WHERE id=? AND workspace_key=? AND revision=?",
    ).run(id, workspaceKey, expectedRevision);
    if (!result.changes) throw new Error("environment.conflict");
  }
  binding(key: string): Binding {
    const row = this.database!.prepare(
      "SELECT data FROM project_environment_sessions WHERE session_key=?",
    ).get(key) as { data: string } | undefined;
    return row
      ? (JSON.parse(row.data) as Binding)
      : { revision: 0, environmentId: null, environmentRevision: null };
  }
  bind(key: string, value: Binding, expectedRevision: number): void {
    const database = this.database!;
    const result =
      expectedRevision === 0
        ? database
            .prepare(
              "INSERT OR IGNORE INTO project_environment_sessions(session_key,revision,data) VALUES(?,?,?)",
            )
            .run(key, value.revision, JSON.stringify(value))
        : database
            .prepare(
              "UPDATE project_environment_sessions SET revision=?,data=? WHERE session_key=? AND revision=?",
            )
            .run(value.revision, JSON.stringify(value), key, expectedRevision);
    if (!result.changes) throw new Error("environment.conflict");
  }
  close(): void {
    this.database?.close();
    this.database = undefined;
  }
}
