import {
  type IMemoryService,
  type ProjectMemoryFileSummary,
  type ProjectMemoryWorkspaceSummary,
} from "./memory.js";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PROJECT_MEMORY_METADATA_FILE, PROJECT_MEMORY_MIGRATION_MARKER } from "@zcode/shared/node";
import { readProjectMemoryFileFromStableHandle } from "#src/memory/projectMemoryStableRead.js";
import { getZCodeDataRootDir } from "#src/paths.js";

const PROJECT_MEMORY_INDEX_FILE_NAME = "MEMORY.md";
const PROJECT_MEMORY_DIRECTORY_NAME = "memory";
const PROJECT_KEY_SUFFIX_PATTERN = /^(.*)-[a-f0-9]{16}$/i;

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getProjectMemoriesRoot(): string {
  return join(getZCodeDataRootDir(), "cli", "memories", "projects");
}

function isValidPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isProjectMemoryFileName(fileName: string): boolean {
  return (
    fileName === PROJECT_MEMORY_INDEX_FILE_NAME ||
    (fileName.endsWith(".md") && fileName !== PROJECT_MEMORY_INDEX_FILE_NAME)
  );
}

function resolveWorkspaceLabel(workspaceId: string): string {
  const slug = PROJECT_KEY_SUFFIX_PATTERN.exec(workspaceId)?.[1];
  return slug?.trim() || workspaceId;
}

interface ProjectMemoryMetadata {
  displayPath: string;
  kind: "repository" | "workspace" | "identity";
  workspaceIdentity?: string;
}

async function readProjectMemoryMetadata(
  projectsRoot: string,
  memoryRoot: string,
): Promise<ProjectMemoryMetadata | undefined> {
  const metadataPath = join(memoryRoot, PROJECT_MEMORY_METADATA_FILE);
  try {
    const { content } = await readProjectMemoryFileFromStableHandle({
      fileName: PROJECT_MEMORY_METADATA_FILE,
      filePath: metadataPath,
      validatePath: () => assertContainedProjectMemoryPath(projectsRoot, memoryRoot),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 1 &&
      "kind" in parsed &&
      (parsed.kind === "repository" || parsed.kind === "workspace" || parsed.kind === "identity") &&
      "displayPath" in parsed &&
      typeof parsed.displayPath === "string" &&
      parsed.displayPath.length > 0
    ) {
      return {
        displayPath: parsed.displayPath,
        kind: parsed.kind,
        ...("workspaceIdentity" in parsed && typeof parsed.workspaceIdentity === "string"
          ? { workspaceIdentity: parsed.workspaceIdentity }
          : {}),
      };
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  return undefined;
}

async function isMigratedLegacyMemory(projectsRoot: string, memoryRoot: string): Promise<boolean> {
  const markerPath = join(memoryRoot, PROJECT_MEMORY_MIGRATION_MARKER);
  let destination: string;
  try {
    const { content } = await readProjectMemoryFileFromStableHandle({
      fileName: PROJECT_MEMORY_MIGRATION_MARKER,
      filePath: markerPath,
      validatePath: () => assertContainedProjectMemoryPath(projectsRoot, memoryRoot),
    });
    let recordedDestination = content.trim();
    if (recordedDestination.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(recordedDestination);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("destination" in parsed) ||
          typeof parsed.destination !== "string"
        )
          return false;
        recordedDestination = parsed.destination;
      } catch {
        return false;
      }
    }
    destination = resolve(recordedDestination);
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
  if (
    dirname(dirname(destination)) !== projectsRoot ||
    basename(destination) !== PROJECT_MEMORY_DIRECTORY_NAME ||
    destination === memoryRoot
  ) {
    return false;
  }
  if (!(await isPlainDirectory(destination))) return false;
  try {
    const index = await lstat(join(destination, PROJECT_MEMORY_INDEX_FILE_NAME));
    return index.isFile() && !index.isSymbolicLink();
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function isPlainDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function requirePlainDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Project Memory directory is not a regular directory: ${path}`);
  }
}

async function requireProjectMemoriesRoot(): Promise<string> {
  const projectsRoot = getProjectMemoriesRoot();
  // 只校验 workspace 子目录时，projectsRoot symlink 会让 list/read 跟随到本地数据目录外。
  await requirePlainDirectory(projectsRoot);
  return projectsRoot;
}

async function requireExactProjectMemoryFile(
  memoryRoot: string,
  fileName: string,
): Promise<string> {
  const memoryEntries = await readdir(memoryRoot, { withFileTypes: true });
  const fileEntry = memoryEntries.find((entry) => entry.name === fileName);
  const requestedFilePath = join(memoryRoot, fileName);
  if (!fileEntry) {
    // 文件确实不存在时继续透传原始 ENOENT；只有大小写别名能命中时才拒绝读取。
    await lstat(requestedFilePath);
    throw new Error(`Project Memory file name does not match exactly: ${fileName}`);
  }
  if (!fileEntry.isFile() || fileEntry.isSymbolicLink()) {
    throw new Error(`Project Memory file is not a regular file: ${fileName}`);
  }
  return requestedFilePath;
}

async function assertContainedProjectMemoryPath(
  projectsRoot: string,
  targetPath: string,
): Promise<void> {
  const projectsRootRealPath = await realpath(projectsRoot);
  const targetRealPath = await realpath(targetPath);
  const relativePath = relative(projectsRootRealPath, targetRealPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Project Memory path is outside the local profile: ${targetPath}`);
  }
}

function compareProjectMemoryFiles(
  left: ProjectMemoryFileSummary,
  right: ProjectMemoryFileSummary,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "index" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "en");
}

export function createMemoryService(): IMemoryService {
  async function listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]> {
    let projectsRoot: string;
    let projectEntries;
    try {
      projectsRoot = await requireProjectMemoriesRoot();
      projectEntries = await readdir(projectsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    const workspaces: ProjectMemoryWorkspaceSummary[] = [];
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) {
        continue;
      }

      const workspaceId = projectEntry.name;
      const workspaceRoot = join(projectsRoot, workspaceId);
      const memoryRoot = join(workspaceRoot, PROJECT_MEMORY_DIRECTORY_NAME);
      if (!(await isPlainDirectory(workspaceRoot)) || !(await isPlainDirectory(memoryRoot))) {
        continue;
      }

      // 修复原因：旧目录只在已迁移目标仍存在时从列表隐藏，避免目标丢失后无法找回原件。
      if (await isMigratedLegacyMemory(projectsRoot, memoryRoot)) continue;

      let memoryEntries;
      try {
        memoryEntries = await readdir(memoryRoot, { withFileTypes: true });
      } catch (error) {
        // 目录检查后 Memory Agent 仍可能删除目录；catalog 快照只跳过已消失的 workspace。
        if (isNotFoundError(error)) {
          continue;
        }
        throw error;
      }
      const files: ProjectMemoryFileSummary[] = [];
      for (const memoryEntry of memoryEntries) {
        if (
          !memoryEntry.isFile() ||
          memoryEntry.isSymbolicLink() ||
          !isProjectMemoryFileName(memoryEntry.name)
        ) {
          continue;
        }

        const filePath = join(memoryRoot, memoryEntry.name);
        let fileMetadata;
        try {
          fileMetadata = await lstat(filePath);
        } catch (error) {
          // readdir 后事实文件可能被并发删除；它不再属于本次只读快照。
          if (isNotFoundError(error)) {
            continue;
          }
          throw error;
        }
        if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) {
          continue;
        }
        files.push({
          name: memoryEntry.name,
          path: filePath,
          kind: memoryEntry.name === PROJECT_MEMORY_INDEX_FILE_NAME ? "index" : "item",
          size: fileMetadata.size,
          updatedAt: fileMetadata.mtimeMs,
        });
      }

      if (files.length === 0) {
        continue;
      }

      files.sort(compareProjectMemoryFiles);
      const metadata = await readProjectMemoryMetadata(projectsRoot, memoryRoot);
      const displayPath = metadata?.displayPath;
      const baseLabel = displayPath
        ? basename(displayPath) || resolveWorkspaceLabel(workspaceId)
        : resolveWorkspaceLabel(workspaceId);
      const hashLabel = `${baseLabel} · ${workspaceId.slice(-16, -8)}`;
      workspaces.push({
        id: workspaceId,
        label: metadata?.kind === "identity" || !displayPath ? hashLabel : baseLabel,
        displayPath,
        workspaceIdentity: metadata?.workspaceIdentity,
        updatedAt: Math.max(...files.map((file) => file.updatedAt)),
        files,
      });
    }

    const labelCounts = new Map<string, number>();
    for (const workspace of workspaces) {
      labelCounts.set(workspace.label, (labelCounts.get(workspace.label) ?? 0) + 1);
    }
    for (const workspace of workspaces) {
      if ((labelCounts.get(workspace.label) ?? 0) > 1) {
        workspace.label = `${workspace.label} · ${workspace.id.slice(-16, -8)}`;
      }
    }

    workspaces.sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id, "en"),
    );
    return workspaces;
  }

  async function readProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
  }): Promise<{ content: string; updatedAt: number }> {
    if (
      !isValidPathSegment(params.workspaceId) ||
      !isValidPathSegment(params.fileName) ||
      !isProjectMemoryFileName(params.fileName)
    ) {
      throw new Error("Invalid Project Memory path");
    }

    const projectsRoot = await requireProjectMemoriesRoot();
    const workspaceRoot = join(projectsRoot, params.workspaceId);
    const memoryRoot = join(workspaceRoot, PROJECT_MEMORY_DIRECTORY_NAME);
    await requirePlainDirectory(workspaceRoot);
    await requirePlainDirectory(memoryRoot);

    // 大小写不敏感文件系统会让请求名称命中不同大小写的磁盘文件，绕过 catalog 白名单。
    const filePath = await requireExactProjectMemoryFile(memoryRoot, params.fileName);
    return readProjectMemoryFileFromStableHandle({
      fileName: params.fileName,
      filePath,
      validatePath: async () => {
        await requireProjectMemoriesRoot();
        await requirePlainDirectory(workspaceRoot);
        await requirePlainDirectory(memoryRoot);
        await requireExactProjectMemoryFile(memoryRoot, params.fileName);
        await assertContainedProjectMemoryPath(projectsRoot, filePath);
      },
    });
  }

  return {
    listProjectMemories,
    readProjectMemoryFile,
  };
}
