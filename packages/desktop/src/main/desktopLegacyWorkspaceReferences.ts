import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const nodeRequire = createRequire(import.meta.url);
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function workspaceHash(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

async function rewriteJsonWorkspacePath(
  file: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (!(await pathExists(file))) return;
  const data = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const lastSessions = data.lastWorkspaceSession;
  let changed = false;
  if (lastSessions && typeof lastSessions === "object") {
    for (const session of Object.values(lastSessions)) {
      if (
        session &&
        typeof session === "object" &&
        "workspacePath" in session &&
        session.workspacePath === oldPath
      ) {
        session.workspacePath = newPath;
        changed = true;
      }
    }
  }
  // 默认工作区搬迁后，最近项目入口也必须指向新目录，避免重新打开旧版的数据。
  if (Array.isArray(data.recentProjects)) {
    data.recentProjects = data.recentProjects.map((path) => {
      if (path !== oldPath) return path;
      changed = true;
      return newPath;
    });
  }
  if (changed) await writeFile(file, JSON.stringify(data), "utf8");
}

async function rewriteSqliteWorkspacePaths(
  file: string,
  oldPath: string,
  newPath: string,
  kind: "task" | "cli",
): Promise<void> {
  if (!(await pathExists(file))) return;
  const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    const hasTable = (table: string): boolean =>
      Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    db.exec("BEGIN IMMEDIATE");
    try {
      if (kind === "cli") {
        if (hasTable("session")) {
          for (const column of ["directory", "path"]) {
            db.prepare(`UPDATE session SET ${column}=? WHERE ${column}=?`).run(newPath, oldPath);
          }
        }
      } else {
        if (hasTable("tasks")) {
          const records = db
            .prepare("SELECT workspace_key, task_id, meta_json FROM tasks WHERE workspace_path=?")
            .all(oldPath);
          for (const record of records) {
            const meta = JSON.parse(String(record.meta_json)) as Record<string, unknown>;
            if (meta.workspacePath === oldPath) meta.workspacePath = newPath;
            db.prepare("UPDATE tasks SET meta_json=? WHERE workspace_key=? AND task_id=?").run(
              JSON.stringify(meta),
              record.workspace_key as string,
              record.task_id as string,
            );
          }
        }
        const columns: Record<string, string[]> = {
          tasks: ["workspace_key", "workspace_path", "root_path"],
          task_group_members: ["workspace_key", "workspace_path"],
          task_group_workspace_bootstraps: ["workspace_key"],
          task_group_admissions: ["workspace_key"],
          automations: ["workspace_key", "workspace_path"],
          off_peak_tasks: ["workspace_key", "workspace_path"],
        };
        for (const [table, names] of Object.entries(columns)) {
          if (!hasTable(table)) continue;
          const available = new Set(
            (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
              (row) => row.name,
            ),
          );
          for (const column of names) {
            if (available.has(column))
              db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(newPath, oldPath);
          }
        }
        if (hasTable("task_group_view_node_orders")) {
          const rows = db.prepare("SELECT node_key FROM task_group_view_node_orders").all();
          for (const row of rows) {
            const key = String(row.node_key);
            let parts: unknown;
            try {
              parts = JSON.parse(key);
            } catch {
              continue;
            }
            if (Array.isArray(parts) && parts[0] === oldPath) {
              db.prepare("UPDATE task_group_view_node_orders SET node_key=? WHERE node_key=?").run(
                JSON.stringify([newPath, ...parts.slice(1)]),
                key,
              );
            }
          }
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function rewriteDefaultWorkspaceReferences(
  temporary: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  await rewriteJsonWorkspacePath(join(temporary, "v2", "setting.json"), oldPath, newPath);
  await rewriteSqliteWorkspacePaths(
    join(temporary, "v2", "tasks-index.sqlite"),
    oldPath,
    newPath,
    "task",
  );
  await rewriteSqliteWorkspacePaths(
    join(temporary, "cli", "db", "db.sqlite"),
    oldPath,
    newPath,
    "cli",
  );
  const oldSessionDir = join(temporary, "v2", "sessions", workspaceHash(oldPath));
  const newSessionDir = join(temporary, "v2", "sessions", workspaceHash(newPath));
  if ((await pathExists(oldSessionDir)) && !(await pathExists(newSessionDir))) {
    await rename(oldSessionDir, newSessionDir);
  }
}
