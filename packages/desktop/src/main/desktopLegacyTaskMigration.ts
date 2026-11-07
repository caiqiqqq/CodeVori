import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync, backup } = require("node:sqlite") as typeof import("node:sqlite");
const DATABASES = {
  "work-tasks.sqlite": ["work_tasks", "work_task_projects", "work_task_events"],
  "agent-delegations.sqlite": [
    "delegations",
    "delegation_parents",
    "delegation_settings",
    "delegation_child_sessions",
  ],
};

export function isLegacyTaskDatabaseEntry(entry: string): boolean {
  return Object.keys(DATABASES).some(
    (file) => entry === file || entry === `${file}-wal` || entry === `${file}-shm`,
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function rewriteData(value: unknown, oldWorkspace: string, newWorkspace: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "workspacePath" && item === oldWorkspace
        ? newWorkspace
        : key === "parent" || key === "rootParent"
          ? rewriteData(item, oldWorkspace, newWorkspace)
          : item,
    ]),
  );
}

function rewriteRow(
  row: Record<string, import("node:sqlite").SQLOutputValue>,
  oldWorkspace: string,
  newWorkspace: string,
  table: string,
) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (
        (key === "meta_json" ||
          (key === "data" &&
            ["work_tasks", "delegations", "delegation_settings"].includes(table))) &&
        typeof value === "string"
      ) {
        return [key, JSON.stringify(rewriteData(JSON.parse(value), oldWorkspace, newWorkspace))];
      }
      if (
        ["workspace_key", "workspace_path", "root_path", "directory", "path", "key"].includes(
          key,
        ) &&
        value === oldWorkspace
      )
        return [key, newWorkspace];
      if (
        ["parent_key", "key", "node_key"].includes(key) &&
        typeof value === "string" &&
        value.startsWith("[")
      ) {
        const parts: unknown = JSON.parse(value);
        if (Array.isArray(parts) && parts[0] === oldWorkspace)
          return [key, JSON.stringify([newWorkspace, ...parts.slice(1)])];
      }
      return [key, value];
    }),
  );
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type Sqlite = InstanceType<typeof DatabaseSync>;
interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function alignColumns(legacy: Sqlite, product: Sqlite, table: string) {
  const source = legacy.prepare(`PRAGMA table_info(${quote(table)})`).all() as unknown as Column[];
  const target = product.prepare(`PRAGMA table_info(${quote(table)})`).all() as unknown as Column[];
  const primaryKey = (columns: Column[]) =>
    columns
      .filter((column) => column.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
  if (JSON.stringify(primaryKey(source)) !== JSON.stringify(primaryKey(target)))
    throw new Error(`Incompatible legacy primary key: ${table}`);
  for (const column of source) {
    if (target.some((existing) => existing.name === column.name)) continue;
    // 旧数据可能来自较新构建；保留附加字段，但不能冒充已经执行了对应 schema migration。
    if (column.notnull && column.dflt_value === null)
      throw new Error(`Cannot safely add required legacy column: ${table}.${column.name}`);
    product.exec(
      `ALTER TABLE ${quote(table)} ADD COLUMN ${quote(column.name)} ${column.type}${column.notnull ? " NOT NULL" : ""}${column.dflt_value === null ? "" : ` DEFAULT ${column.dflt_value}`}`,
    );
  }
}

/** 仅迁移业务行；数据库身份与 schema 版本继续由各自运行时管理。 */
export async function mergeLegacyDatabase(
  sourceFile: string,
  targetFile: string,
  backupRoot: string,
  oldWorkspace: string,
  newWorkspace: string,
  selectedTables?: string[],
): Promise<void> {
  if (!(await exists(sourceFile))) return;
  await mkdir(dirname(targetFile), { recursive: true });
  const targetExists = await exists(targetFile);
  const legacy = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    legacy.exec("BEGIN");
    const product = new DatabaseSync(targetFile);
    try {
      product.exec("PRAGMA busy_timeout=5000");
      if (targetExists) {
        const backups = join(backupRoot, ".legacy-task-backups", randomUUID());
        await mkdir(backups, { recursive: true });
        await backup(product, join(backups, basename(targetFile)));
      }
      const tables =
        selectedTables ??
        legacy
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
          )
          .all()
          .map((row) => String(row.name))
          .filter(
            (table) =>
              !["schema_migration", "tasks_schema_migration", "zcode_database_identity"].includes(
                table,
              ),
          );
      product.exec("BEGIN IMMEDIATE");
      try {
        const importedTasks = new Set<string>();
        for (const table of tables) {
          const schema = legacy
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
            .get(table);
          if (!schema) continue;
          if (
            !product.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
          )
            product.exec(String(schema.sql));
          else alignColumns(legacy, product, table);
          for (const original of legacy.prepare(`SELECT * FROM ${quote(table)}`).iterate()) {
            const row = rewriteRow(original, oldWorkspace, newWorkspace, table);
            if (table === "work_task_events") {
              if (!importedTasks.has(String(row.task_id))) continue;
              // sequence 是库内序号，恢复事件时重新分配，避免与新版事件相撞。
              delete row.sequence;
            }
            const columns = Object.keys(row);
            const result = product
              .prepare(
                `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT DO NOTHING`,
              )
              .run(...Object.values(row));
            if (table === "work_tasks" && result.changes) importedTasks.add(String(row.id));
          }
          for (const index of legacy
            .prepare(
              "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
            )
            .all(table)) {
            if (!product.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(index.name))
              product.exec(String(index.sql));
          }
        }
        if (product.prepare("PRAGMA foreign_key_check").get())
          throw new Error("Legacy history contains missing references");
        product.exec("COMMIT");
      } catch (error) {
        product.exec("ROLLBACK");
        throw error;
      }
    } finally {
      product.close();
    }
  } finally {
    legacy.close();
  }
}

/** 启动前执行；业务状态仍由 Host 的任务仓库持有，迁移只补入缺失主键。 */
export async function migrateLegacyTaskDatabases(source: string, target: string): Promise<void> {
  for (const [file, tables] of Object.entries(DATABASES)) {
    await mergeLegacyDatabase(
      join(source, file),
      join(target, file),
      target,
      join(source, "workspace", "default"),
      join(target, "workspace", "default"),
      tables,
    );
  }
}
