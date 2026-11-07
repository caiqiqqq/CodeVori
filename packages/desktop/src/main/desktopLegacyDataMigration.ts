import { rewriteDefaultWorkspaceReferences } from "./desktopLegacyWorkspaceReferences.js";
import { upgradeLegacyProductPaths } from "./desktopProductPathUpgrade.js";
import { randomUUID } from "node:crypto";
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
import { basename, dirname, join, relative, sep } from "node:path";
import {
  isLegacyTaskDatabaseEntry,
  migrateLegacyTaskDatabases,
} from "./desktopLegacyTaskMigration.js";
import {
  isLegacyHistoryDatabaseEntry,
  migrateLegacyHistory,
} from "./desktopLegacyHistoryMigration.js";

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
  resolveAdditionalLegacyDataRoots?: () => Promise<DataRootPair[]>;
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

async function readMigrationState(
  targetRoot: string,
): Promise<{ status: "pending" | "complete"; version: number } | null> {
  try {
    const raw = JSON.parse(await readFile(join(targetRoot, MIGRATION_MARKER), "utf8")) as {
      status?: unknown;
      version?: unknown;
    };
    return raw.status === "pending" || raw.status === "complete"
      ? { status: raw.status, version: typeof raw.version === "number" ? raw.version : 1 }
      : null;
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
  await writeFile(temporary, JSON.stringify({ version: 3, status }), "utf8");
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
    !isLegacyTaskDatabaseEntry(entry) &&
    !isLegacyHistoryDatabaseEntry(entry) &&
    entry !== ".legacy-task-backups" &&
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
    const result = await migrateLegacyDesktopDataUnlocked(options);
    if (result !== "legacy-running" && result !== "migration-running") {
      await upgradeLegacyProductPaths(options.legacyDataRoots[0]!.target);
    }
    return result;
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
  const businessAlreadyCurrent = state?.status === "complete";
  // v1 仅复制缺失文件，已经存在的空待办/指派库会被漏迁；v2 补迁一次后恢复产品隔离。
  const needsTaskRepair = businessAlreadyCurrent && state.version < 2;
  const needsHistoryRepair = businessAlreadyCurrent && state.version < 3;
  const profileAlreadyCurrent = await pathExists(options.productProfile);
  if (businessAlreadyCurrent && !needsHistoryRepair && profileAlreadyCurrent) {
    return "already-current";
  }
  // 修复依据：完成迁移后旧版设置已不属于 CodeVori，不能因其损坏而阻止新版启动。
  const legacyDataRoots =
    businessAlreadyCurrent && !needsHistoryRepair
      ? options.legacyDataRoots
      : [
          ...options.legacyDataRoots,
          ...((await options.resolveAdditionalLegacyDataRoots?.()) ?? []),
        ];
  const hasLegacy =
    (await pathExists(options.legacyProfile)) ||
    (await Promise.all(legacyDataRoots.map((pair) => pathExists(pair.source)))).some(Boolean);
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
    const rewriteReferences = async (root: string): Promise<void> => {
      // 自定义 dataBaseDir 也有自己的默认工作区；不能只迁移 home 下的记录。
      for (const pair of legacyDataRoots) {
        await rewriteDefaultWorkspaceReferences(
          root,
          join(pair.source, "workspace", "default"),
          join(pair.target, "workspace", "default"),
        );
      }
    };
    for (const [index, pair] of legacyDataRoots.entries()) {
      await copyDirectoryAtomically(
        pair.source,
        pair.target,
        shouldCopyBusinessEntry,
        rewriteReferences,
        index === 0 && !firstTargetExists,
      );
      await rewriteReferences(pair.target);
    }
  }
  if (!businessAlreadyCurrent || needsTaskRepair) {
    for (const pair of legacyDataRoots) {
      await migrateLegacyTaskDatabases(pair.source, pair.target);
    }
  }
  if (!businessAlreadyCurrent || needsHistoryRepair) {
    for (const pair of legacyDataRoots) await migrateLegacyHistory(pair.source, pair.target);
  }
  await copyDirectoryAtomically(
    options.legacyProfile,
    options.productProfile,
    shouldCopyProfileEntry,
  );
  if (!businessAlreadyCurrent || needsHistoryRepair)
    await writeMigrationState(first.target, "complete");
  // 已有新版数据且旧源已移除时，仅升级标记，保持已完成安装的返回语义。
  return hasLegacy ? "migrated" : businessAlreadyCurrent ? "already-current" : "no-legacy";
}
