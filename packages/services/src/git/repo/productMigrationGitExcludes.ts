import { appendFile, lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withFileLock } from "@zcode/shared/node";
import { DEFAULT_GIT_COMMAND_TIMEOUT_MS } from "../config.js";
import type { GitCommandProvider } from "../providers/gitCommandProvider.js";
import { ensureGitCommandSucceeded } from "./gitCliHelpers.js";

const MIGRATION_DIRECTORY = ".codevori";
const MIGRATION_MARKER = `${MIGRATION_DIRECTORY}/.product-path-migration-v2.json`;

async function regularFile(path: string): Promise<Buffer | null> {
  try {
    const entry = await lstat(path);
    return entry.isFile() ? await readFile(path) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 兼容旧版本迁移遗漏的本地 Git 规则，绝不把整个产品配置目录排除。 */
export async function syncProductMigrationGitExcludes(
  worktreePath: string,
  commands: GitCommandProvider,
): Promise<void> {
  try {
    if (!(await lstat(join(worktreePath, MIGRATION_DIRECTORY))).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const marker = await regularFile(join(worktreePath, MIGRATION_MARKER));
  if (!marker) return;
  try {
    const value: unknown = JSON.parse(marker.toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 2 ||
      !("status" in value) ||
      value.status !== "complete"
    )
      return;
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
  const run = (args: string[]) =>
    commands.run({
      cwd: worktreePath,
      args,
      timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
    });
  const rules = [`/${MIGRATION_MARKER}`];
  const [legacy, current] = await Promise.all([
    regularFile(join(worktreePath, ".zcodeignore")),
    regularFile(join(worktreePath, ".codevoriignore")),
  ]);
  if (legacy && current && legacy.equals(current)) {
    const ignored = await run(["check-ignore", "-q", "--", ".zcodeignore"]);
    // Git 的 1 表示没有忽略规则；其他错误不能被当作用户已经选择忽略。
    if (ignored.exitCode !== 1 || ignored.timedOut || ignored.outputTruncated)
      ensureGitCommandSucceeded("git check-ignore", ignored);
    if (ignored.exitCode === 0) {
      const currentRule = await run([
        "check-ignore",
        "-v",
        "--non-matching",
        "--",
        ".codevoriignore",
      ]);
      if (currentRule.exitCode !== 1 || currentRule.timedOut || currentRule.outputTruncated)
        ensureGitCommandSucceeded("git check-ignore", currentRule);
      // 新路径的显式 ! 规则是用户自己的选择，迁移兼容不能用后追加的规则覆盖它。
      const explicitlyIncluded = /:\d+:!/.test(currentRule.stdout.split("\t")[0] ?? "");
      if (!explicitlyIncluded) rules.push("/.codevoriignore");
    }
  }
  const location = await run(["rev-parse", "--git-path", "info/exclude"]);
  ensureGitCommandSucceeded("git rev-parse", location);
  const excludePath = resolve(worktreePath, location.stdout.trim());
  await withFileLock(`${excludePath}.product-migration.lock`, async () => {
    let existing = "";
    try {
      existing = await readFile(excludePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const lines = new Set(existing.split(/\r?\n/));
    const missing = rules.filter((rule) => !lines.has(rule));
    if (!missing.length) return;
    // 修复依据：迁移复制了已忽略的旧文件，却遗漏新路径；补本地规则后仍执行完整脏检查。
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(excludePath, `${separator}${missing.join("\n")}\n`, "utf8");
  });
}
