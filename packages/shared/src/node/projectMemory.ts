import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const PROJECT_MEMORY_INDEX_LINE_LIMIT = 200;
export const PROJECT_MEMORY_INDEX_CHARACTER_LIMIT = 25_000;

export interface ProjectMemoryRootInput {
  cliStorageRoot: string;
  workspaceIdentity?: string;
  workspacePath: string;
}

export interface ProjectMemoryScope {
  root: string;
  legacyRoot?: string;
  kind: "repository" | "workspace" | "identity";
  displayPath: string;
  workspaceIdentity?: string;
}

/** Keep the original path algorithm for existing project-memory directories. */

export function resolveProjectMemoryRoot(input: ProjectMemoryRootInput): string {
  const workspaceIdentity = input.workspaceIdentity?.trim();
  const normalizedWorkspacePath = resolve(input.workspacePath);
  const keySource =
    workspaceIdentity ||
    (process.platform === "win32"
      ? normalizedWorkspacePath.toLowerCase()
      : normalizedWorkspacePath);
  const hash = createHash("sha256").update(keySource).digest("hex").slice(0, 16);
  const slug = workspaceIdentity
    ? "project"
    : sanitizeProjectSlug(basename(normalizedWorkspacePath) || "project");

  return join(input.cliStorageRoot, "memories", "projects", `${slug}-${hash}`, "memory");
}

/**
 * A local linked worktree shares its common Git directory with the main checkout.
 * Identity-backed and non-Git workspaces keep the existing isolation key.
 */
export async function resolveProjectMemoryScope(
  input: ProjectMemoryRootInput,
): Promise<ProjectMemoryScope> {
  const workspacePath = resolve(input.workspacePath);
  const legacyRoot = resolveProjectMemoryRoot(input);
  const workspaceIdentity = input.workspaceIdentity?.trim();
  if (workspaceIdentity) {
    return { root: legacyRoot, kind: "identity", displayPath: workspacePath, workspaceIdentity };
  }

  const repository = await findGitCommonDirectory(workspacePath);
  if (!repository) {
    return { root: legacyRoot, kind: "workspace", displayPath: workspacePath };
  }

  const hash = createHash("sha256")
    .update(`repository:${repository.commonDirectory}`)
    .digest("hex")
    .slice(0, 16);
  const displayPath =
    basename(repository.commonDirectory) === ".git"
      ? dirname(repository.commonDirectory)
      : repository.workspaceRoot;
  const slug = sanitizeProjectSlug(basename(displayPath) || "project");
  return {
    root: join(input.cliStorageRoot, "memories", "projects", `${slug}-${hash}`, "memory"),
    legacyRoot,
    kind: "repository",
    displayPath,
  };
}

async function findGitCommonDirectory(
  workspacePath: string,
): Promise<{ commonDirectory: string; workspaceRoot: string } | undefined> {
  let directory = workspacePath;
  while (true) {
    const marker = join(directory, ".git");
    let metadata;
    try {
      metadata = await lstat(marker);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (metadata?.isDirectory()) {
      return { commonDirectory: await realpath(marker), workspaceRoot: directory };
    }
    if (metadata?.isFile()) {
      const match = /^gitdir:\s*(.+)\s*$/im.exec(await readFile(marker, "utf8"));
      if (match) {
        const gitDirPath = match[1]!.trim();
        const gitDirectory: string = await realpath(
          isAbsolute(gitDirPath) ? gitDirPath : resolve(directory, gitDirPath),
        );
        let commonDirectory: string = gitDirectory;
        try {
          const relativeCommonDirectory = (
            await readFile(join(gitDirectory, "commondir"), "utf8")
          ).trim();
          if (relativeCommonDirectory) {
            commonDirectory = await realpath(resolve(gitDirectory, relativeCommonDirectory));
          }
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
        return { commonDirectory, workspaceRoot: directory };
      }
    }
    if (metadata) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sanitizeProjectSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "project";
}

export function buildProjectMemoryInstructions(memoryRoot: string): string {
  return [
    "# Memory",
    "",
    `You have a persistent file-based memory at \`${memoryRoot}/\`. This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence). Each memory is one file holding one fact, with frontmatter:`,
    "",
    "```markdown",
    "---",
    "name: <short-kebab-case-slug>",
    "description: <one-line summary — used to decide relevance during recall>",
    "metadata:",
    "  type: user | feedback | project | reference",
    "---",
    "",
    "<the fact; for feedback/project, follow with **Why:** and **How to apply:** lines. Link related memories with [[their-name]].>",
    "```",
    "",
    "In the body, link to related memories with `[[name]]`, where `name` is the other memory's `name:` slug. Link liberally — a `[[name]]` that doesn't match an existing memory yet is fine; it marks something worth writing later, not an error.",
    "",
    "`user` — who the user is (role, expertise, preferences). `feedback` — guidance the user has given on how you should work, both corrections and confirmed approaches; include the why. `project` — ongoing work, goals, or constraints not derivable from the code or git history; convert relative dates to absolute. `reference` — pointers to external resources (URLs, dashboards, tickets).",
    "",
    "After writing the file, add a one-line pointer in `MEMORY.md` (`- [Title](file.md) — hook`). `MEMORY.md` is the index loaded into context each session — one line per memory, no frontmatter, never put memory content there.",
    "",
    "Before saving, check for an existing file that already covers it — update that file rather than creating a duplicate; delete memories that turn out to be wrong. Don't save what the repo already records (code structure, past fixes, git history, AGENTS.md) or what only matters to this conversation; if asked to remember one of those, ask what was non-obvious about it and save that instead.",
  ].join("\n");
}
