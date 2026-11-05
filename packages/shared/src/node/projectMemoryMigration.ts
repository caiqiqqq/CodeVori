import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  PROJECT_MEMORY_INDEX_CHARACTER_LIMIT,
  PROJECT_MEMORY_INDEX_LINE_LIMIT,
  type ProjectMemoryScope,
} from "./projectMemory.js";
import { atomicWritePrivateTextFile, withFileLock } from "./privateFilePersistence.js";

export const PROJECT_MEMORY_METADATA_FILE = ".project.json";
export const PROJECT_MEMORY_MIGRATION_MARKER = ".migrated-to";

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function requirePlainDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Project Memory directory is not a regular directory: ${path}`);
  }
}

async function ensurePlainDirectory(path: string, recursive = false): Promise<void> {
  try {
    await mkdir(path, { recursive });
  } catch (error) {
    if (
      !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
  await requirePlainDirectory(path);
}

async function readRegularFile(path: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Project Memory file is not a regular file: ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function writeMetadata(scope: ProjectMemoryScope): Promise<void> {
  const path = join(scope.root, PROJECT_MEMORY_METADATA_FILE);
  const existing = await readRegularFile(path);
  if (existing !== undefined) return;
  const metadata = JSON.stringify({
    version: 1,
    kind: scope.kind,
    displayPath: scope.displayPath,
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
  });
  try {
    await writeFile(path, `${metadata}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
    await readRegularFile(path);
  }
}

function renameFactFrontmatter(content: string, fileName: string): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(content);
  if (!match) return content;
  const header = match[2]!.replace(/^name:[^\r\n]*$/m, `name: ${basename(fileName, ".md")}`);
  return `${match[1]}${header}${match[3]}${content.slice(match[0].length)}`;
}

async function copyFact(
  sourceRoot: string,
  targetRoot: string,
  sourceName: string,
): Promise<string> {
  const source = await readRegularFile(join(sourceRoot, sourceName));
  if (source === undefined) throw new Error(`Missing Project Memory fact: ${sourceName}`);
  const current = await readRegularFile(join(targetRoot, sourceName));
  if (current === source) return sourceName;
  let targetName = sourceName;
  let content = source;
  if (current !== undefined) {
    // 修复原因：不同工作树可能使用相同文件名记录不同事实；迁移不能覆盖任一事实。
    const sourceId = createHash("sha256").update(sourceRoot).digest("hex").slice(0, 8);
    const stem = basename(sourceName, ".md").slice(0, 48);
    targetName = `${stem}-legacy-${sourceId}.md`;
    content = renameFactFrontmatter(source, targetName);
    const alternate = await readRegularFile(join(targetRoot, targetName));
    if (alternate === content) return targetName;
    if (alternate !== undefined) {
      const contentId = createHash("sha256").update(source).digest("hex").slice(0, 8);
      targetName = `${stem}-legacy-${sourceId}-${contentId}.md`;
      content = renameFactFrontmatter(source, targetName);
      if ((await readRegularFile(join(targetRoot, targetName))) === content) return targetName;
    }
  }
  await writeFile(join(targetRoot, targetName), content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return targetName;
}

async function migrateLegacyRoot(scope: ProjectMemoryScope): Promise<void> {
  const sourceRoot = scope.legacyRoot;
  if (!sourceRoot || resolve(sourceRoot) === resolve(scope.root)) return;
  try {
    await requirePlainDirectory(sourceRoot);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const facts = entries
    .filter((entry) => entry.name.endsWith(".md") && entry.name !== "MEMORY.md")
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`Project Memory fact is not a regular file: ${entry.name}`);
      }
      return entry.name;
    })
    .sort();
  const legacyIndex = (await readRegularFile(join(sourceRoot, "MEMORY.md"))) ?? "";
  const currentIndex = (await readRegularFile(join(scope.root, "MEMORY.md"))) ?? "";
  const sourceHash = createHash("sha256").update(legacyIndex);
  for (const name of facts) {
    sourceHash.update(name).update((await readRegularFile(join(sourceRoot, name))) ?? "");
  }
  const sourceDigest = sourceHash.digest("hex");
  const markerPath = join(sourceRoot, PROJECT_MEMORY_MIGRATION_MARKER);
  const marker = await readRegularFile(markerPath);
  if (marker !== undefined && currentIndex) {
    let recordedDigest: string | undefined;
    try {
      const parsed: unknown = JSON.parse(marker);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "destination" in parsed &&
        parsed.destination === scope.root &&
        "sourceDigest" in parsed &&
        typeof parsed.sourceDigest === "string"
      ) {
        recordedDigest = parsed.sourceDigest;
      }
    } catch {
      // 旧格式只有目标路径；先记录当前快照，避免重新导入已人工去重的事实。
      if (marker.trim() === scope.root) recordedDigest = sourceDigest;
    }
    if (recordedDigest === sourceDigest) {
      if (!marker.trimStart().startsWith("{")) {
        await atomicWritePrivateTextFile(
          markerPath,
          `${JSON.stringify({ destination: scope.root, sourceDigest })}\n`,
        );
      }
      return;
    }
  }
  const lines = currentIndex.split(/\r?\n/).filter(Boolean);
  const copiedNames = new Map<string, string>();
  for (const sourceName of facts) {
    const targetName = await copyFact(sourceRoot, scope.root, sourceName);
    copiedNames.set(sourceName, targetName);
  }
  for (const sourceLine of legacyIndex.split(/\r?\n/).filter(Boolean)) {
    let targetLine = sourceLine;
    for (const [sourceName, targetName] of copiedNames) {
      targetLine = targetLine.replace(`](${sourceName})`, `](${targetName})`);
    }
    if (!lines.includes(targetLine)) lines.push(targetLine);
  }
  const targetEntries = await readdir(scope.root, { withFileTypes: true });
  for (const targetEntry of targetEntries) {
    if (!targetEntry.name.endsWith(".md") || targetEntry.name === "MEMORY.md") continue;
    if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) {
      throw new Error(`Project Memory fact is not a regular file: ${targetEntry.name}`);
    }
    const targetName = targetEntry.name;
    if (!lines.some((line) => line.includes(`](${targetName})`))) {
      lines.push(`- [${basename(targetName, ".md")}](${targetName}) — migrated memory`);
    }
  }
  const nextIndex = `${lines.join("\n")}\n`;
  if (
    lines.length > PROJECT_MEMORY_INDEX_LINE_LIMIT ||
    nextIndex.length > PROJECT_MEMORY_INDEX_CHARACTER_LIMIT
  ) {
    throw new Error("Project Memory index limit exceeded during migration");
  }
  if (lines.join("\n") !== currentIndex.trim()) {
    await atomicWritePrivateTextFile(join(scope.root, "MEMORY.md"), nextIndex);
  }
  await atomicWritePrivateTextFile(
    markerPath,
    `${JSON.stringify({ destination: scope.root, sourceDigest })}\n`,
  );
}

/** Prepare the canonical root before either CLI or ACP reads or writes it. */
export async function prepareProjectMemoryScope(scope: ProjectMemoryScope): Promise<void> {
  const root = resolve(scope.root);
  const projectRoot = dirname(root);
  const projectsRoot = dirname(projectRoot);
  const memoriesRoot = dirname(projectsRoot);
  const storageRoot = dirname(memoriesRoot);
  await ensurePlainDirectory(storageRoot, true);
  await ensurePlainDirectory(memoriesRoot);
  await ensurePlainDirectory(projectsRoot);
  await ensurePlainDirectory(projectRoot);
  await ensurePlainDirectory(root);
  await withFileLock(join(root, ".migration.lock"), async () => {
    await writeMetadata(scope);
    await migrateLegacyRoot(scope);
  });
}
