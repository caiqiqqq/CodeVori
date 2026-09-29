import { isAbsoluteFilePath, joinFilePath } from "./path.js";

const DEFAULT_WORKTREE_DIRECTORY_SEGMENTS = [".code", "worktrees"] as const;

export function resolveDefaultWorktreeRoot(homeDirectory: string): string {
  const trimmedHomeDirectory = homeDirectory.trim();
  if (trimmedHomeDirectory.length === 0) {
    return DEFAULT_WORKTREE_DIRECTORY_SEGMENTS.join("/");
  }

  return DEFAULT_WORKTREE_DIRECTORY_SEGMENTS.reduce(
    (root, segment) => joinFilePath(root, segment),
    trimmedHomeDirectory,
  );
}

function expandHomeDirectory(path: string, homeDirectory: string): string {
  const trimmedPath = path.trim();
  const trimmedHomeDirectory = homeDirectory.trim();
  if (trimmedPath === "~") {
    return trimmedHomeDirectory || trimmedPath;
  }

  const homePrefix = trimmedPath.startsWith("~/") || trimmedPath.startsWith("~\\");
  return homePrefix && trimmedHomeDirectory
    ? joinFilePath(trimmedHomeDirectory, trimmedPath.slice(2))
    : trimmedPath;
}

export function resolveWorktreeRootPath(options: {
  configuredRoot?: string | null;
  homeDirectory: string;
  workspacePath: string;
}): string | null {
  const configuredRoot = options.configuredRoot?.trim();
  if (!configuredRoot && !options.homeDirectory.trim()) {
    return null;
  }
  const root = configuredRoot || resolveDefaultWorktreeRoot(options.homeDirectory);
  const expandedRoot = expandHomeDirectory(root, options.homeDirectory);

  if (expandedRoot === "~" || expandedRoot.startsWith("~/") || expandedRoot.startsWith("~\\")) {
    return null;
  }

  if (!expandedRoot.trim()) {
    return null;
  }

  return isAbsoluteFilePath(expandedRoot)
    ? expandedRoot
    : joinFilePath(options.workspacePath, expandedRoot);
}

export function normalizeConfiguredWorktreeRoot(
  value: string,
  defaultRoot: string,
): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== defaultRoot ? normalized : undefined;
}
