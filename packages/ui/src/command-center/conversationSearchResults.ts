import type { AcpSessionSearchItem, ZCodeTaskMeta } from "@zcode/shared";

export type NativeSearchItem = ZCodeTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};
export type SearchConversation =
  | { kind: "native"; item: NativeSearchItem }
  | { kind: "acp"; item: AcpSessionSearchItem };
export interface ConversationSearchRow {
  key: string;
  conversation: SearchConversation;
  searchSnippet?: string;
  snippetIndex?: number;
  entryId?: string;
  rowId?: number;
}

function conversationKey(conversation: SearchConversation): string {
  const item = conversation.item;
  return JSON.stringify([
    conversation.kind,
    item.workspaceIdentity?.trim() || item.workspacePath,
    item.workspacePath,
    conversation.kind === "native" ? conversation.item.taskId : conversation.item.id,
  ]);
}

function uniqueSnippets(item: NativeSearchItem): string[] {
  const snippets = item.searchSnippets?.length
    ? item.searchSnippets
    : item.searchSnippet
      ? [item.searchSnippet]
      : [];
  const seen = new Set<string>();
  return snippets.filter((snippet) => {
    const normalized = snippet
      .replace(/^\.\.\./, "")
      .replace(/\.\.\.$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildConversationSearchRows(params: {
  nativeItems: readonly NativeSearchItem[];
  acpItems: readonly AcpSessionSearchItem[];
  query: string;
  limit: number;
}): ConversationSearchRow[] {
  const byKey = new Map<string, SearchConversation>();
  for (const item of params.nativeItems) {
    const conversation = { kind: "native" as const, item };
    const key = conversationKey(conversation);
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing?.kind === "native"
        ? {
            kind: "native",
            item: {
              ...existing.item,
              searchSnippets: [...uniqueSnippets(existing.item), ...uniqueSnippets(item)],
            },
          }
        : conversation,
    );
  }
  for (const item of params.acpItems) {
    const conversation = { kind: "acp" as const, item };
    const key = conversationKey(conversation);
    const existing = byKey.get(key);
    if (existing?.kind !== "acp" || existing.item.revision <= item.revision)
      byKey.set(key, conversation);
  }
  const conversations = [...byKey.values()]
    .sort(
      (left, right) =>
        right.item.updatedAt - left.item.updatedAt ||
        right.item.createdAt - left.item.createdAt ||
        conversationKey(left).localeCompare(conversationKey(right)),
    )
    .slice(0, params.limit);
  return conversations.flatMap((conversation): ConversationSearchRow[] => {
    const key = conversationKey(conversation);
    if (params.query && conversation.kind === "native") {
      const snippets = uniqueSnippets(conversation.item);
      if (snippets.length)
        return snippets.map((searchSnippet, snippetIndex) => ({
          key: `${key}:${snippetIndex}`,
          conversation,
          searchSnippet,
          snippetIndex,
        }));
    }
    if (params.query && conversation.kind === "acp" && conversation.item.matches.length)
      return conversation.item.matches.map((match) => ({
        key: `${key}:${match.entryId}`,
        conversation,
        searchSnippet: match.snippet,
        entryId: match.entryId,
        rowId: match.rowId,
      }));
    return [{ key, conversation }];
  });
}
