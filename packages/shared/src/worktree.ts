import { isAbsoluteFilePath, joinFilePath } from "./file-path.js";

export function resolveDefaultWorktreeRoot(homeDirectory: string): string {
  const home = homeDirectory.trim();
  return home ? joinFilePath(joinFilePath(home, ".code"), "worktrees") : ".code/worktrees";
}

export function resolveWorktreeRootPath(options: {
  configuredRoot?: string | null;
  homeDirectory: string;
  workspacePath: string;
}): string | null {
  const configured = options.configuredRoot?.trim();
  const home = options.homeDirectory.trim();
  if (!configured && !home) return null;
  let root = configured || resolveDefaultWorktreeRoot(home);
  if (root === "~") root = home || root;
  else if ((root.startsWith("~/") || root.startsWith("~\\")) && home)
    root = joinFilePath(home, root.slice(2));
  if (!root || root === "~" || root.startsWith("~/") || root.startsWith("~\\")) return null;
  return isAbsoluteFilePath(root) ? root : joinFilePath(options.workspacePath, root);
}

export function normalizeConfiguredWorktreeRoot(
  value: string,
  defaultRoot: string,
): string | undefined {
  const normalized = value.trim();
  return normalized && normalized !== defaultRoot ? normalized : undefined;
}
