const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const UNC_PATH_RE = /^\\\\/;

export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(path) || UNC_PATH_RE.test(path);
}

export function joinFilePath(basePath: string, childPath: string): string {
  if (!childPath) return basePath;
  if (isAbsoluteFilePath(childPath)) return childPath;
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  return `${basePath.replace(/[\\/]+$/, "")}${separator}${childPath.replace(/^[\\/]+/, "")}`;
}
