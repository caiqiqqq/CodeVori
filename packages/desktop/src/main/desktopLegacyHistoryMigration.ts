import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mergeLegacyDatabase } from "./desktopLegacyTaskMigration.js";

const HISTORY_DATABASES = [join("cli", "db", "db.sqlite"), join("v2", "tasks-index.sqlite")];

export function isLegacyHistoryDatabaseEntry(entry: string): boolean {
  return HISTORY_DATABASES.some((file) => [file, `${file}-wal`, `${file}-shm`].includes(entry));
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function replaceWithBackup(file: string, before: string, after: string, backup: string) {
  await mkdir(backup, { recursive: true });
  const filename = basename(file);
  await copyFile(file, join(backup, filename));
  // 首启在 Host 建立前运行；维护恢复时若文件正在变化则中止，不能覆盖会话新写入。
  if ((await readFile(file, "utf8")) !== before)
    throw new Error("ACP session changed during migration");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, after, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function rewriteAcpWorkspace(target: string, oldWorkspace: string, newWorkspace: string) {
  const directory = join(target, "acp-sessions");
  const files = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const backup = join(target, ".legacy-task-backups", randomUUID(), "acp-sessions");
  for (const name of files.filter((file) => file.endsWith(".json"))) {
    const file = join(directory, name);
    const before = await readFile(file, "utf8");
    const checkpoint = JSON.parse(before) as { workspacePath?: string };
    let changed = false;
    if (checkpoint.workspacePath === oldWorkspace) {
      checkpoint.workspacePath = newWorkspace;
      await replaceWithBackup(file, before, JSON.stringify(checkpoint), backup);
      changed = true;
    }
    const journal = await readOptional(`${file}.journal`);
    if (journal !== null) {
      let journalChanged = false;
      const lines = journal.split("\n");
      const next = lines
        .map((line, index) => {
          // journal 只承认换行结束的 revision；未完成尾部交给原 store 处理。
          if (!line || index === lines.length - 1) return line;
          const record = JSON.parse(line) as { metadata?: { workspacePath?: string } };
          if (record.metadata?.workspacePath !== oldWorkspace) return line;
          record.metadata.workspacePath = newWorkspace;
          journalChanged = true;
          return JSON.stringify(record);
        })
        .join("\n");
      if (journalChanged) {
        await replaceWithBackup(`${file}.journal`, journal, next, backup);
        changed = true;
      }
    }
    // summary 是派生缓存；必须失效，否则旧 scope 仍会让已迁移会话从列表消失。
    if (changed && (await readOptional(`${file}.summary`)) !== null) {
      await mkdir(backup, { recursive: true });
      await copyFile(`${file}.summary`, join(backup, `${name}.summary`));
      await rm(`${file}.summary`, { force: true });
    }
  }
}

/** 普通任务索引、CLI 正文和 ACP 归属组成同一迁移边界，完成后才启动业务 Host。 */
export async function migrateLegacyHistory(source: string, target: string): Promise<void> {
  const oldWorkspace = join(source, "workspace", "default");
  const newWorkspace = join(target, "workspace", "default");
  for (const file of HISTORY_DATABASES) {
    await mergeLegacyDatabase(
      join(source, file),
      join(target, file),
      target,
      oldWorkspace,
      newWorkspace,
    );
  }
  await rewriteAcpWorkspace(target, oldWorkspace, newWorkspace);
}
