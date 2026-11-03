export interface AcpComposerContext {
  codeComments: boolean;
  /** 网页元素复用 API 的文本尾块，可通过 ACP text 发送。 */
  webElements: boolean;
  pptxElements: boolean;
  selections: boolean;
  sharedContext: boolean;
}

/** 空 ACP 会话仍属于首页草稿；首条记录产生后才切到普通对话时间线。 */
export function hasAcpConversationContent(
  session:
    | (Pick<import("@zcode/shared").AcpSession, "entries" | "pendingPermission"> &
        Partial<Pick<import("@zcode/shared").AcpSession, "queue" | "pendingElicitation">>)
    | null,
): boolean {
  return Boolean(
    session &&
    (session.entries.length > 0 ||
      ("history" in session && (session.history as { entryCount: number }).entryCount > 0) ||
      session.pendingPermission ||
      session.pendingElicitation ||
      session.queue?.items.length),
  );
}

/** 其余原生结构化上下文仍需独立 Host 契约；网页元素走文本，附件走内容块。 */
export function getAcpComposerBlockingReason(context: AcpComposerContext): "context" | null {
  if (context.codeComments || context.pptxElements || context.selections || context.sharedContext) {
    return "context";
  }
  return null;
}
