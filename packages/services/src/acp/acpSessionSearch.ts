import {
  acpSessionActivity,
  acpEntryRowId,
  isAcpHistorySession,
  acpSessionSearchResultSchema,
  type AcpSession,
  type AcpSessionSearchInput,
  type AcpSessionSearchItem,
} from "@zcode/shared";

export function searchAcpSessions(
  sessions: readonly AcpSession[],
  input: AcpSessionSearchInput,
): AcpSessionSearchItem[] {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const items: AcpSessionSearchItem[] = [];
  for (const session of sessions) {
    if (!isAcpHistorySession(session) || session.archived) continue;
    const matches: AcpSessionSearchItem["matches"] = [];
    if (query) {
      for (const [entryIndex, entry] of session.entries.entries()) {
        // 修复原因：ACP 不进入原生 tasks-index；仅搜索可见聊天正文，不能把工具日志或配置混入搜索。
        if (entry.kind !== "user" && entry.kind !== "assistant") continue;
        const index = entry.text.toLocaleLowerCase().indexOf(query);
        if (index < 0) continue;
        const start = Math.max(0, index - 60);
        const end = Math.min(entry.text.length, start + 180);
        matches.push({
          entryId: entry.id,
          rowId: acpEntryRowId(entryIndex),
          snippet: `${start > 0 ? "..." : ""}${entry.text.slice(start, end).replace(/\s+/g, " ")}${end < entry.text.length ? "..." : ""}`,
        });
        if (matches.length === 5) break;
      }
      if (matches.length === 0 && !session.title.toLocaleLowerCase().includes(query)) continue;
    }
    items.push({
      id: session.id,
      agent: session.agent,
      title: session.title,
      status: session.status,
      revision: session.revision,
      workspacePath: session.workspacePath,
      ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
      ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
      ...acpSessionActivity(session),
      matches,
    });
  }
  items.sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt ||
      left.id.localeCompare(right.id),
  );
  return acpSessionSearchResultSchema.parse(items.slice(0, input.limit ?? 80));
}
