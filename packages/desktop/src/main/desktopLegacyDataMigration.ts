import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";

const nodeRequire = createRequire(import.meta.url);

const MIGRATION_MARKER = ".migration-from-zcode.json";
type DataRootPair = { source: string; target: string };

export type LegacyDataMigrationResult =
  | "migrated"
  | "already-current"
  | "legacy-running"
  | "migration-running"
  | "no-legacy";

export interface LegacyDataMigrationOptions {
  legacyDataRoots: DataRootPair[];
  legacyProfile: string;
  productProfile: string;
  migrationLock?: string;
  isLegacyRunning?: () => Promise<boolean>;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function acquireMigrationLock(path: string): Promise<(() => Promise<void>) | null> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(path);
      await writeFile(join(path, "pid"), String(process.pid), "utf8");
      return () => rm(path, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pidFile = join(path, "pid");
      let owner: number | null = null;
      try {
        owner = Number(await readFile(pidFile, "utf8"));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError;
        // mkdir 与写入 pid 之间有极短间隔；缺少 pid 时先让当前启动者完成初始化。
        if (Date.now() - (await stat(path)).mtimeMs < 5_000) return null;
      }
      if (owner && Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
          return null;
        } catch (killError) {
          if ((killError as NodeJS.ErrnoException).code !== "ESRCH") return null;
        }
      }
      const stale = `${path}.stale-${randomUUID()}`;
      try {
        await rename(path, stale);
        await rm(stale, { recursive: true, force: true });
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      }
    }
  }
  return null;
}

async function readMigrationState(targetRoot: string): Promise<"pending" | "complete" | null> {
  try {
    const raw = JSON.parse(await readFile(join(targetRoot, MIGRATION_MARKER), "utf8")) as {
      status?: unknown;
    };
    return raw.status === "pending" || raw.status === "complete" ? raw.status : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeMigrationState(
  targetRoot: string,
  status: "pending" | "complete",
): Promise<void> {
  const marker = join(targetRoot, MIGRATION_MARKER);
  const temporary = `${marker}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, status }), "utf8");
  try {
    await rename(temporary, marker);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function shouldCopyBusinessEntry(root: string, source: string): boolean {
  const entry = relative(root, source);
  if (entry === "") return true;
  // 修复原因：复制旧设备 ID 会让两款应用以同一设备身份注册；新目录必须生成自己的 ID。
  return (
    entry !== join("v2", "telemetry-state.json") &&
    entry !== join("v2", "telemetry-state.lock") &&
    // 两款应用的代理 CA 私钥必须独立；CodeVori 首次启动时生成自己的证书。
    entry !== join("v2", "certs") &&
    // 旧辅助进程具有 ZCode 的 bundle ID 和权限身份，CodeVori 必须自行安装并请求权限。
    entry !== "computer-use" &&
    entry !== join("v2", "bots-runtime-locks")
  );
}

function shouldCopyProfileEntry(root: string, source: string): boolean {
  const entry = relative(root, source);
  if (entry === "") return true;
  if (entry.split(sep)[0] !== "session") return false;
  return basename(source) !== "LOCK";
}

async function copyDirectoryAtomically(
  source: string,
  target: string,
  shouldCopy: (root: string, entry: string) => boolean,
  transform?: (temporary: string) => Promise<void>,
  pendingMarker = false,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.migration-${randomUUID()}`;
  try {
    if (await pathExists(source)) {
      await cp(source, temporary, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (entry) => shouldCopy(source, entry),
      });
    } else {
      await mkdir(temporary, { recursive: true });
    }
    await transform?.(temporary);
    if (pendingMarker) await writeMigrationState(temporary, "pending");
    if (await pathExists(target)) {
      // 修复原因：CodeVori 可能已先建出空设置目录；仅补入缺失文件，不覆盖其已有数据。
      await cp(temporary, target, { recursive: true, force: false, errorOnExist: false });
    } else {
      await rename(temporary, target);
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
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
  if (!lastSessions || typeof lastSessions !== "object") return;
  let changed = false;
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

async function rewriteDefaultWorkspaceReferences(
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

/** Check the old Electron profile before copying its SQLite, LevelDB and Cookie files. */
export async function isLegacyDesktopProfileRunning(profile: string): Promise<boolean> {
  const lock = join(profile, "SingletonLock");
  if (!(await pathExists(lock))) return false;
  let owner: string;
  try {
    owner = await readlink(lock);
  } catch {
    // 非 symlink 锁无法安全判断是否失效，保守地要求关闭旧应用。
    return true;
  }
  const pid = Number(/-(\d+)$/u.exec(owner)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Copy-once migration. No old path is renamed, deleted or written. */
export async function migrateLegacyDesktopData(
  options: LegacyDataMigrationOptions,
): Promise<LegacyDataMigrationResult> {
  const release = options.migrationLock ? await acquireMigrationLock(options.migrationLock) : null;
  if (options.migrationLock && !release) return "migration-running";
  try {
    return await migrateLegacyDesktopDataUnlocked(options);
  } finally {
    await release?.();
  }
}

async function migrateLegacyDesktopDataUnlocked(
  options: LegacyDataMigrationOptions,
): Promise<LegacyDataMigrationResult> {
  const first = options.legacyDataRoots[0];
  if (!first) throw new Error("legacyDataRoots must include the user home data root");
  const state = await readMigrationState(first.target);
  const businessAlreadyCurrent = state === "complete";
  const profileAlreadyCurrent = await pathExists(options.productProfile);
  if (businessAlreadyCurrent && profileAlreadyCurrent) {
    return "already-current";
  }
  const hasLegacy =
    (await pathExists(options.legacyProfile)) ||
    (await Promise.all(options.legacyDataRoots.map((pair) => pathExists(pair.source)))).some(
      Boolean,
    );
  if (
    hasLegacy &&
    (await (
      options.isLegacyRunning ?? (() => isLegacyDesktopProfileRunning(options.legacyProfile))
    )())
  ) {
    return "legacy-running";
  }

  if (!businessAlreadyCurrent) {
    const firstTargetExists = await pathExists(first.target);
    if (firstTargetExists) await writeMigrationState(first.target, "pending");
    const oldDefault = join(first.source, "workspace", "default");
    const newDefault = join(first.target, "workspace", "default");
    for (const [index, pair] of options.legacyDataRoots.entries()) {
      await copyDirectoryAtomically(
        pair.source,
        pair.target,
        shouldCopyBusinessEntry,
        (temporary) => rewriteDefaultWorkspaceReferences(temporary, oldDefault, newDefault),
        index === 0 && !firstTargetExists,
      );
      await rewriteDefaultWorkspaceReferences(pair.target, oldDefault, newDefault);
    }
  }
  await copyDirectoryAtomically(
    options.legacyProfile,
    options.productProfile,
    shouldCopyProfileEntry,
  );
  if (!businessAlreadyCurrent) await writeMigrationState(first.target, "complete");
  return hasLegacy ? "migrated" : "no-legacy";
}
