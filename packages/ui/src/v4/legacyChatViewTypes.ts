/** 竖切后 ChatView 已删；保留 shell / command-center 仍引用的最小类型。 */
interface SearchResultHighlightBase {
  requestId: number;
  workspacePath: string;
  workspaceIdentity?: string;
  query: string;
  snippet?: string;
  snippetIndex?: number;
  rowId?: number;
}

export type ChatSearchResultHighlightRequest = SearchResultHighlightBase &
  (
    | { kind?: "native"; taskId: string; acpSessionId?: never; entryId?: never }
    | { kind: "acp"; acpSessionId: string; entryId?: string; taskId?: never }
  );

export type ChatSearchResultHighlightInput =
  | Omit<Extract<ChatSearchResultHighlightRequest, { taskId: string }>, "requestId">
  | Omit<Extract<ChatSearchResultHighlightRequest, { kind: "acp" }>, "requestId">;

export interface ConversationFindMatchState {
  matchCount: number;
  activeIndex?: number;
}

export type ChatViewSummaryPanelVariant = "panel" | "mini";
