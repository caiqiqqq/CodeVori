import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { containsProjectMemorySecret } from "./projectMemorySecrets.js";

export interface ProjectMemoryCandidate {
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
  content: string;
}

const locks = new Map<string, Promise<void>>();
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validate(candidate: ProjectMemoryCandidate): ProjectMemoryCandidate {
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
): Promise<void> {
  if (!candidates.length) return;
  const validated = candidates.map(validate);
  const previous = locks.get(memoryRoot) ?? Promise.resolve();
  const work = previous
    .catch(() => {})
    .then(async () => {
      await validateRoot();
      const indexPath = join(memoryRoot, "MEMORY.md");
      await assertRegularFileOrMissing(indexPath);
      let index = "";
      try {
        index = await readFile(indexPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      let lines = index.split(/\r?\n/).filter(Boolean);
      for (const candidate of validated) {
        lines = lines.filter((line) => !line.includes(`](${candidate.name}.md)`));
        lines.push(`- [${candidate.description}](${candidate.name}.md) — ${candidate.description}`);
      }
      const next = `${lines.join("\n")}\n`;
      if (lines.length > 200 || next.length > 25_000)
        throw new Error("Project Memory index limit exceeded");
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
        await atomicWrite(path, frontmatter, validateRoot);
      }
      await atomicWrite(indexPath, next, validateRoot);
    });
  locks.set(memoryRoot, work);
  try {
    await work;
  } finally {
    if (locks.get(memoryRoot) === work) locks.delete(memoryRoot);
  }
}
