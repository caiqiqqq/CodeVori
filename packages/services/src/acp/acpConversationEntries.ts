import type { AcpPlanStep, AcpSession } from "@zcode/shared";

export type AcpConversationUpdate =
  | { kind: "text"; text: string; messageId?: string }
  | { kind: "thought"; text: string; messageId?: string }
  | { kind: "plan"; entries: AcpPlanStep[] };

export function finishAcpThoughts(
  session: Pick<AcpSession, "entries">,
  state: "complete" | "interrupted",
  receivedAt: number,
): void {
  for (const entry of session.entries) {
    if (entry.kind !== "thought" || entry.state !== "streaming") continue;
    entry.state = state;
    if (entry.createdAt !== undefined) entry.durationMs = Math.max(0, receivedAt - entry.createdAt);
  }
}

export function appendAcpConversationEntry(
  session: AcpSession,
  commandId: string,
  update: AcpConversationUpdate,
  receivedAt: number,
): void {
  if (update.kind === "plan") {
    finishAcpThoughts(session, "complete", receivedAt);
    const id = `plan:${commandId}`;
    const previous = session.entries.find((entry) => entry.id === id && entry.kind === "plan");
    // 修复原因：ACP plan 是完整列表替换，空列表也必须清除旧步骤；不伪造工具调用。
    if (previous?.kind === "plan") previous.entries = structuredClone(update.entries);
    else
      session.entries.push({
        id,
        kind: "plan",
        entries: structuredClone(update.entries),
        createdAt: receivedAt,
      });
    return;
  }
  if (!update.text) return;
  const kind = update.kind === "thought" ? "thought" : "assistant";
  const baseId = `${kind}:${commandId}:${update.messageId ?? "default"}`;
  const previous = session.entries.at(-1);
  if (
    previous?.kind === kind &&
    (previous.id === baseId || previous.id.startsWith(`${baseId}:segment:`)) &&
    (previous.kind !== "thought" || previous.state === "streaming")
  ) {
    previous.text += update.text;
    return;
  }
  // 修复原因：正文、工具与不同思考段必须按接收顺序落位，不能拼回工具前的旧段。
  finishAcpThoughts(session, "complete", receivedAt);
  const id = session.entries.some((entry) => entry.id === baseId)
    ? `${baseId}:segment:${session.entries.length}`
    : baseId;
  session.entries.push(
    kind === "thought"
      ? { id, kind, text: update.text, createdAt: receivedAt, state: "streaming" }
      : { id, kind, text: update.text, createdAt: receivedAt },
  );
}
