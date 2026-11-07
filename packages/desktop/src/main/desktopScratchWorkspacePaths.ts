import { readFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, sep } from "node:path";

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

/** 只读枚举实际持久化的 scratch 工作区引用，避免递归扫描用户项目树。 */
export async function collectScratchWorkspacePaths(
  root: string,
  scratch: string,
): Promise<Set<string>> {
  const paths = new Set<string>([scratch]);
  const collect = (value: unknown): void => {
    if (typeof value === "string" && (value === scratch || value.startsWith(`${scratch}${sep}`))) {
      paths.add(value);
    }
  };
  const settings = join(root, "v2", "setting.json");
  if (await pathExists(settings)) {
    const data = JSON.parse(await readFile(settings, "utf8")) as Record<string, unknown>;
    if (Array.isArray(data.recentProjects)) data.recentProjects.forEach(collect);
    if (data.lastWorkspaceSession && typeof data.lastWorkspaceSession === "object") {
      for (const session of Object.values(data.lastWorkspaceSession)) {
        if (session && typeof session === "object" && "workspacePath" in session)
          collect(session.workspacePath);
      }
    }
  }
  const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
  for (const [file, tables] of [
    [
      join(root, "v2/tasks-index.sqlite"),
      {
        tasks: ["workspace_path"],
        task_group_members: ["workspace_path"],
        automations: ["workspace_path"],
        off_peak_tasks: ["workspace_path"],
      },
    ],
    [join(root, "cli/db/db.sqlite"), { session: ["directory", "path"] }],
  ] as const) {
    if (!(await pathExists(file))) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      for (const [table, columns] of Object.entries(tables)) {
        const available = new Set(
          (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
            (row) => row.name,
          ),
        );
        for (const column of columns) {
          if (!available.has(column)) continue;
          for (const row of db.prepare(`SELECT DISTINCT ${column} AS path FROM ${table}`).all())
            collect(row.path);
        }
      }
    } finally {
      db.close();
    }
  }
  return paths;
}
