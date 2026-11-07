import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  PRODUCT_DATA_DIRECTORY_NAME,
  PRODUCT_LEGACY_DATA_DIRECTORY_NAME,
} from "../product-brand.mjs";
import { atomicWritePrivateTextFile, withFileLock } from "./privateFilePersistence.js";

const MARKER = ".product-path-migration-v2.json";
type PathPair = { source: string; target: string };

async function inspect(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function rewritePath(value: string, pairs: readonly PathPair[]): string {
  for (const { source, target } of pairs) {
    const normalized = value.replaceAll("\\", "/");
    const normalizedSource = source.replaceAll("\\", "/");
    const comparable = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    const comparableSource =
      process.platform === "win32" ? normalizedSource.toLowerCase() : normalizedSource;
    if (comparable === comparableSource || comparable.startsWith(`${comparableSource}/`)) {
      const replacement = value.includes("\\") ? target : target.replaceAll("\\", "/");
      return replacement + value.slice(source.length);
    }
  }
  return value;
}

function rewriteReferences(value: unknown, pairs: readonly PathPair[]): unknown {
  if (typeof value === "string") return rewritePath(value, pairs);
  if (Array.isArray(value)) return value.map((entry) => rewriteReferences(entry, pairs));
  if (value && typeof value === "object") {
    // 新 key 优先，避免旧绝对路径 key 与新路径 key 归一后覆盖用户的新设置。
    const entries = Object.entries(value).sort(
      ([a], [b]) => Number(rewritePath(a, pairs) === a) - Number(rewritePath(b, pairs) === b),
    );
    return Object.fromEntries(
      entries.map(([key, entry]) => [rewritePath(key, pairs), rewriteReferences(entry, pairs)]),
    );
  }
  return value;
}

async function rewriteConfig(path: string, pairs: readonly PathPair[]): Promise<void> {
  const entry = await inspect(path);
  if (!entry) return;
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error(`Migration config must be a regular file: ${path}`);
  const raw = await readFile(path, "utf8");
  // 修复依据：只改结构化配置中的路径前缀，不替换 shell 命令、提示词和用户文档里的文字。
  let original: unknown;
  try {
    original = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // 旧配置损坏时保留原文；迁移不能阻断其他资源加载，配置服务会报告解析错误。
    return;
  }
  const rewritten = rewriteReferences(original, pairs);
  if (JSON.stringify(original) !== JSON.stringify(rewritten)) {
    await atomicWritePrivateTextFile(path, `${JSON.stringify(rewritten, null, 2)}\n`);
  }
}

async function ensureDirectory(path: string): Promise<void> {
  const entry = await inspect(path);
  if (entry) {
    if (entry.isSymbolicLink())
      throw new Error(`Migration target cannot be a symbolic link: ${path}`);
    if (!entry.isDirectory()) throw new Error(`Migration target must be a directory: ${path}`);
    return;
  }
  await mkdir(path, { recursive: true });
}

async function copyMissing(pair: PathPair, rewrites: readonly PathPair[]): Promise<void> {
  const source = await inspect(pair.source);
  if (!source) return;
  await ensureDirectory(dirname(pair.target));
  const target = await inspect(pair.target);
  // 修复原因：复制到已有 symlink 会继续写旧应用的数据；冲突时停止并保留可重试状态。
  if (target?.isSymbolicLink()) {
    const targetLink = resolve(dirname(pair.target), await readlink(pair.target));
    const sourceLink = source.isSymbolicLink()
      ? resolve(dirname(pair.source), await readlink(pair.source))
      : pair.source;
    const mappedLink = rewritePath(sourceLink, rewrites);
    if (targetLink === mappedLink && mappedLink !== sourceLink) return;
    if (targetLink !== sourceLink) {
      throw new Error(`Migration target cannot be a symbolic link: ${pair.target}`);
    }
    // v1 整库迁移可能原样复制指向旧目录的 symlink；转为新目录的独立副本。
    await rm(pair.target);
  }
  if (source.isDirectory()) {
    await ensureDirectory(pair.target);
    for (const name of await readdir(pair.source)) {
      if (name === MARKER || name.endsWith(".path-migration.lock")) continue;
      await copyMissing(
        {
          source: join(pair.source, name),
          target: join(
            pair.target,
            name === ".zcode-share-import.json" ? ".codevori-share-import.json" : name,
          ),
        },
        rewrites,
      );
    }
    return;
  }
  if (target) return;
  await ensureDirectory(dirname(pair.target));
  if (source.isSymbolicLink()) {
    const original = await readlink(pair.source);
    const absolute = isAbsolute(original) ? original : resolve(dirname(pair.source), original);
    const mapped = rewritePath(absolute, rewrites);
    const linked = await stat(pair.source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    try {
      await symlink(mapped, pair.target, linked?.isDirectory() ? "junction" : "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return;
  }
  if (!source.isFile()) return;
  const temporary = join(dirname(pair.target), `.migration-${randomUUID()}.tmp`);
  try {
    await copyFile(pair.source, temporary);
    // link 是排他发布；崩溃只留下临时文件，不会把半个文件误当作已迁移，也不覆盖并发新建的文件。
    try {
      await link(temporary, pair.target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function migrateBase(base: string, user: boolean): Promise<void> {
  const source = join(base, PRODUCT_LEGACY_DATA_DIRECTORY_NAME);
  const target = join(base, PRODUCT_DATA_DIRECTORY_NAME);
  const marker = join(target, MARKER);
  if (await inspect(marker)) return;
  const rewrites: PathPair[] = [
    { source, target },
    { source: "~/.zcode", target: `~/${PRODUCT_DATA_DIRECTORY_NAME}` },
    { source: ".zcode", target: PRODUCT_DATA_DIRECTORY_NAME },
    { source: join(base, ".zcode-share"), target: join(base, ".codevori-share") },
    { source: ".zcode-share", target: ".codevori-share" },
    { source: join(base, "zcode.json"), target: join(base, "codevori.json") },
  ];
  const pairs: PathPair[] = user
    ? [
        "commands",
        "skills",
        "agents",
        "plugins",
        "AGENTS.md",
        "workflows",
        "workflow-drafts",
        "plans",
        "agent-memory",
        "cli",
      ].map((name) => ({ source: join(source, name), target: join(target, name) }))
    : [
        { source, target },
        { source: join(base, "zcode.json"), target: join(base, "codevori.json") },
        { source: join(base, ".zcodeignore"), target: join(base, ".codevoriignore") },
        { source: join(base, ".zcode-share"), target: join(base, ".codevori-share") },
        {
          source: join(base, ".zcode-share-imports.json"),
          target: join(base, ".codevori-share-imports.json"),
        },
      ];
  if (!(await Promise.all(pairs.map((pair) => inspect(pair.source)))).some(Boolean)) return;
  await withFileLock(
    `${target}.path-migration.lock`,
    async () => {
      if (await inspect(marker)) return;
      await ensureDirectory(target);
      if (!user && (await inspect(source))?.isSymbolicLink()) {
        throw new Error(`Migration source root cannot be a symbolic link: ${source}`);
      }
      for (const pair of pairs) await copyMissing(pair, [...pairs, ...rewrites]);
      for (const config of user
        ? [
            join(target, "cli/config.json"),
            join(target, "cli/plugins/installed_plugins.json"),
            join(target, "v2/agents-state.json"),
          ]
        : [
            join(target, "config.json"),
            join(base, "codevori.json"),
            join(base, ".codevori-share-imports.json"),
          ]) {
        await rewriteConfig(config, rewrites);
      }
      await atomicWritePrivateTextFile(marker, '{"version":2,"status":"complete"}\n');
    },
    { lockMaxWaitMs: 300_000 },
  );
}

/**
 * CodeVori 路径的唯一增量迁移入口。Desktop 的整库首启迁移先运行，本入口补齐早期版本
 * 遗留的命令/工作流路径；项目资源在其 Host/CLI 首次读取前复制。锁和完成标记由本模块持有。
 * 未完成时拒绝加载该资源，重试只补缺失文件；完成后不再从旧产品同步，源数据始终保留。
 */
export async function prepareProductPaths(
  input: { homeDirectory?: string; workspacePath?: string } = {},
): Promise<void> {
  const home = resolve(
    input.homeDirectory ?? (process.env.ZCODE_DESKTOP_HOME_DIR?.trim() || homedir()),
  );
  await migrateBase(home, true);
  if (!input.workspacePath) return;
  let current = resolve(input.workspacePath);
  // 与项目资源 discovery 一致：从 cwd 到最近 worktree 根；没有 .git 时仅迁移 cwd。
  const directories = [current];
  while (!(await inspect(join(current, ".git")))) {
    const parent = dirname(current);
    if (parent === current) {
      directories.splice(1);
      break;
    }
    current = parent;
    directories.push(current);
  }
  for (const directory of directories) if (directory !== home) await migrateBase(directory, false);
}

/** Start-from-scratch 的内容迁移仍保留原项目，由调用方在更新工作区引用前完成复制。 */
export async function migrateLegacyScratchRoot(homeDirectory: string): Promise<void> {
  const source = join(homeDirectory, "ZCodeProject");
  const target = join(homeDirectory, "CodeVoriProject");
  const sourceEntry = await inspect(source);
  if (!sourceEntry) return;
  if (sourceEntry.isSymbolicLink())
    throw new Error(`Migration source root cannot be a symbolic link: ${source}`);
  const marker = join(target, MARKER);
  if (await inspect(marker)) return;
  await withFileLock(`${target}.path-migration.lock`, async () => {
    if (await inspect(marker)) return;
    await copyMissing({ source, target }, [{ source, target }]);
    await atomicWritePrivateTextFile(marker, '{"version":2,"status":"complete"}\n');
  });
}
