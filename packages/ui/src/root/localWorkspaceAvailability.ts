import type { PersistedWorkspaceSessionEntry } from "@zcode/shared";

type StatWorkspacePath = (path: string) => Promise<{ type: "directory" | "file" }>;

function isUnavailablePathError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") {
    return true;
  }
  // Host RPC 可能只保留 Error.message，原始 Node 错误码仍可从消息辨认。
  return /\b(?:ENOENT|ENOTDIR|EACCES|EPERM)\b/.test(String(error));
}

export async function resolveUnavailableLocalWorkspacePaths(
  sessions: readonly PersistedWorkspaceSessionEntry[],
  statWorkspacePath: StatWorkspacePath,
  bootstrapUnavailablePath?: string,
): Promise<ReadonlySet<string>> {
  const paths = [
    ...new Set(
      sessions.flatMap((entry) =>
        entry.kind === "local" && entry.workspacePurpose !== "conversation"
          ? [entry.workspacePath]
          : [],
      ),
    ),
  ];
  const unavailable = new Set(bootstrapUnavailablePath ? [bootstrapUnavailablePath] : []);
  // 修复原因：旧代码只检查上次激活的目录，已删除的非激活工作树仍恢复为可用项目。
  // 目录探测只生成本窗口的只读投影，不删除历史或持久化项目记录。
  for (let offset = 0; offset < paths.length; offset += 15) {
    await Promise.all(
      paths.slice(offset, offset + 15).map(async (path) => {
        try {
          const result = await statWorkspacePath(path);
          if (result.type === "directory") unavailable.delete(path);
          else unavailable.add(path);
        } catch (error) {
          if (isUnavailablePathError(error)) unavailable.add(path);
        }
      }),
    );
  }
  return unavailable;
}
