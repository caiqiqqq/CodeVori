import { lstat, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "./privateFilePersistence.js";
import { readProjectMemoryFileFromStableHandle } from "./projectMemoryStableRead.js";
import type { ProjectMemorySaveReceipt } from "../projectMemoryTools.js";
import { containsProjectMemorySecret } from "./projectMemorySecrets.js";

export interface ProjectMemoryCandidate {
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
  content: string;
  expectedRevision?: string | null;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validate(candidate: ProjectMemoryCandidate): ProjectMemoryCandidate {
  if (!candidate || !["user", "feedback", "project", "reference"].includes(candidate.type))
    throw new Error("Invalid Project Memory type");
  const name = candidate.name.trim();
  const description = candidate.description.trim();
  const content = candidate.content.trim();
  if (!NAME.test(name) || name.length > 80 || basename(name) !== name)
    throw new Error("Invalid Project Memory name");
  if (
    !description ||
    description.length > 160 ||
    /[\r\n[\]\\]/.test(description) ||
    !content ||
    content.length > 4000
  )
    throw new Error("Invalid Project Memory content");
  if (containsProjectMemorySecret(description) || containsProjectMemorySecret(content))
    throw new Error("Project Memory secret rejected");
  return { ...candidate, name, description, content };
}

async function assertRegularFileOrMissing(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error(`Project Memory destination is not a regular file: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function atomicWrite(
  path: string,
  text: string,
  validateRoot: () => Promise<void>,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await validateRoot();
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await validateRoot();
    await assertRegularFileOrMissing(path);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** ACP Host writes the same Markdown files and index consumed by native API memory. */
export async function saveProjectMemories(
  memoryRoot: string,
  candidates: readonly ProjectMemoryCandidate[],
  validateRoot: () => Promise<void>,
): Promise<ProjectMemorySaveReceipt[]> {
  if (!candidates.length) return [];
  const validated = candidates.map(validate);
  await validateRoot();
  return withFileLock(join(memoryRoot, ".migration.lock"), async () => {
    await validateRoot();
    const indexPath = join(memoryRoot, "MEMORY.md");
    await assertRegularFileOrMissing(indexPath);
    const index = (await readProjectMemoryItem(memoryRoot, undefined, validateRoot)).content ?? "";
    let lines = index.split(/\r?\n/).filter(Boolean);
    for (const candidate of validated) {
      lines = lines.filter((line) => !line.includes(`](${candidate.name}.md)`));
      lines.push(`- [${candidate.description}](${candidate.name}.md) — ${candidate.description}`);
    }
    const next = `${lines.join("\n")}\n`;
    if (lines.length > 200 || next.length > 25_000)
      throw new Error("Project Memory index limit exceeded");
    const receipts: ProjectMemorySaveReceipt[] = [];
    for (const candidate of validated) {
      const path = join(memoryRoot, `${candidate.name}.md`);
      await assertRegularFileOrMissing(path);
      const frontmatter = [
        "---",
        `name: ${candidate.name}`,
        `description: ${JSON.stringify(candidate.description)}`,
        "metadata:",
        `  type: ${candidate.type}`,
        "---",
        "",
        candidate.content,
        "",
      ].join("\n");
      // 修复原因：外部 ACP 文件权限可能只允许写自身记忆；Host 统一落盘到 ZCode 项目记忆。
      const previous = await readProjectMemoryItem(memoryRoot, candidate.name, validateRoot);
      // 中文依据：同内容重试允许修复部分完成的索引；旧版本不同内容必须拒绝，避免覆盖并发更新。
      if (
        candidate.expectedRevision !== undefined &&
        candidate.expectedRevision !== previous.revision &&
        previous.content !== frontmatter
      )
        throw new Error("Project Memory revision conflict; read the latest item before updating");
      if (previous.content !== frontmatter) await atomicWrite(path, frontmatter, validateRoot);
      receipts.push({
        status: "saved",
        workspaceId: basename(dirname(memoryRoot)),
        fileName: `${candidate.name}.md`,
        revision: revisionOf(frontmatter),
      });
    }
    await atomicWrite(indexPath, next, validateRoot);
    // 回执只在事实和索引均可读且与写入内容一致后发出。
    for (const receipt of receipts) {
      const saved = await readProjectMemoryItem(
        memoryRoot,
        receipt.fileName.slice(0, -3),
        validateRoot,
      );
      if (saved.revision !== receipt.revision)
        throw new Error("Project Memory save verification failed");
    }
    const verifiedIndex = await readProjectMemoryItem(memoryRoot, undefined, validateRoot);
    if (verifiedIndex.content !== next) throw new Error("Project Memory index verification failed");
    return receipts;
  });
}

const revisionOf = (content: string) => createHash("sha256").update(content).digest("hex");

export async function readProjectMemoryItem(
  root: string,
  name: string | undefined,
  validateRoot: () => Promise<void>,
): Promise<{ content: string | null; revision: string | null }> {
  if (name !== undefined && (!NAME.test(name) || name.length > 80))
    throw new Error("Invalid Project Memory name");
  await validateRoot();
  const fileName = name === undefined ? "MEMORY.md" : `${name}.md`;
  try {
    const { content } = await readProjectMemoryFileFromStableHandle({
      fileName,
      filePath: join(root, fileName),
      validatePath: validateRoot,
    });
    return { content, revision: revisionOf(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await validateRoot();
    return { content: null, revision: null };
  }
}
