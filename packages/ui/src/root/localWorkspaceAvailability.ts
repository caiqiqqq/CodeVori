import type { PersistedWorkspaceSessionEntry } from "@zcode/shared";

type StatWorkspacePath = (path: string) => Promise<{ type: "directory" | "file" }>;

function classifyPathError(error: unknown): "missing" | "unavailable" | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return "missing";
  if (code === "EACCES" || code === "EPERM") return "unavailable";
  // Host RPC 可能只保留 Error.message，原始 Node 错误码仍可从消息辨认。
  if (/\b(?:ENOENT|ENOTDIR)\b/.test(String(error))) return "missing";
  if (/\b(?:EACCES|EPERM)\b/.test(String(error))) return "unavailable";
  return null;
}

export async function resolveLocalWorkspaceAvailability(
  sessions: readonly PersistedWorkspaceSessionEntry[],
  statWorkspacePath: StatWorkspacePath,
  bootstrapUnavailablePath?: string,
): Promise<{ missingPaths: ReadonlySet<string>; unavailablePaths: ReadonlySet<string> }> {
  const paths = [
    ...new Set(
      sessions.flatMap((entry) =>
        entry.kind === "local" && entry.workspacePurpose !== "conversation"
          ? [entry.workspacePath]
          : [],
      ),
    ),
  ];
  const missingPaths = new Set<string>();
  const unavailablePaths = new Set(bootstrapUnavailablePath ? [bootstrapUnavailablePath] : []);
  // 修复原因：旧代码只检查上次激活的目录，已删除的非激活工作树仍恢复为可用项目。
  // 只清理明确缺失的项目入口；权限错误保留只读历史，未知错误不改变启动状态。
  for (let offset = 0; offset < paths.length; offset += 15) {
    await Promise.all(
      paths.slice(offset, offset + 15).map(async (path) => {
        try {
          const result = await statWorkspacePath(path);
          if (result.type === "directory") {
            missingPaths.delete(path);
            unavailablePaths.delete(path);
          } else {
            missingPaths.add(path);
            unavailablePaths.delete(path);
          }
        } catch (error) {
          const status = classifyPathError(error);
          if (status === "missing") {
            missingPaths.add(path);
            unavailablePaths.delete(path);
          } else if (status === "unavailable") {
            unavailablePaths.add(path);
          }
        }
      }),
    );
  }
  return { missingPaths, unavailablePaths };
}
