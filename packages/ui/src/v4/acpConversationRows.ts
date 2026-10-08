import type { AcpEntry, AcpSession } from "@zcode/shared";
import type { ConversationRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { ACP_DISPLAY_TOOL_NAME } from "@/lib/acpToolPresentation.js";

/** 展示用工具身份与 ZCode CLI 工具名隔离，避免 Read/Task 等误入原生能力卡。 */
export { ACP_DISPLAY_TOOL_NAME } from "@/lib/acpToolPresentation.js";

export function acpEntryRowId(entryIndex: number): number {
  return entryIndex * 2 + 2;
}

function toolStatus(status: string, turnStatus: AcpSession["status"]): ToolCallRow["status"] {
  switch (status) {
    case "pending":
      return turnStatus === "running" ? "inputStreaming" : "cancelled";
    case "in_progress":
    case "running":
      return turnStatus === "running" ? "running" : "cancelled";
    case "completed":
    case "success":
      return "success";
    case "failed":
    case "error":
      return "error";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      // 修复原因：ACP 适配器的状态词表并非 CLI 状态；未知值不能伪装成成功。
      return turnStatus === "running" ? "running" : "cancelled";
  }
}

function displayText(entry: Extract<AcpEntry, { kind: "user" }>): string {
  // 已保存的图片/文件交给共用附件组件；尾部工作区文件提示与旧会话名称仍保留。
  const remainingNames = entry.attachmentNames?.slice(entry.attachments?.length ?? 0);
  if (!remainingNames?.length) return entry.text;
  const names = remainingNames.map((name) => `📎 ${name}`).join("\n");
  return entry.text ? `${entry.text}\n\n${names}` : names;
}

/** ACP Host 快照的只读展示投影；行 id / turn id 仅供当前时间线，不进入 CLI 协议或持久化。 */
export function buildAcpConversationRows(
  session: Pick<AcpSession, "entries" | "status"> | null,
): ConversationRow[] {
  if (!session) return [];
  const { entries, status } = session;
  const lastUserIndex = entries.findLastIndex((entry) => entry.kind === "user");
  const lastAssistantIndex = entries.findLastIndex((entry) => entry.kind === "assistant");
  const rows: ConversationRow[] = [];
  let turnId = "acp:orphan";
  for (const [index, entry] of entries.entries()) {
    if (entry.kind === "user")
      turnId = `acp:${entry.id.startsWith("user:") ? entry.id.slice(5) : entry.id}`;
    const createdAt = entry.createdAt ?? 0;
    const isLastTurn = lastUserIndex < 0 || index >= lastUserIndex;
    if (entry.kind === "user" || index === 0) {
      rows.push({
        kind: "turnHeader",
        rowId: index * 2 + 1,
        turnId,
        createdAt,
        createdAtSeq: index,
        origin: "userInput",
        executionKind: "agent",
        state:
          isLastTurn && status === "running"
            ? "running"
            : isLastTurn && status === "interrupted"
              ? "completedInterrupted"
              : "completedSuccess",
        startedAt: createdAt,
      });
    }
    const base = {
      rowId: acpEntryRowId(index),
      turnId,
      createdAt,
      createdAtSeq: index,
    };
    if (entry.kind === "user") {
      rows.push({
        ...base,
        kind: "userInput",
        origin: "realUser",
        text: displayText(entry),
        ...(entry.attachments?.length ? { attachments: entry.attachments } : {}),
      });
    } else if (entry.kind === "assistant") {
      rows.push({
        ...base,
        kind: "assistantText",
        text: entry.text,
        state:
          isLastTurn && index === lastAssistantIndex
            ? status === "running"
              ? "streaming"
              : status === "interrupted"
                ? "interrupted"
                : "complete"
            : "complete",
      });
    } else {
      const mappedStatus = toolStatus(entry.status, isLastTurn ? status : "idle");
      const unconfirmed =
        mappedStatus === "cancelled" && entry.status !== "cancelled" && entry.status !== "canceled";
      rows.push({
        ...base,
        kind: "toolCall",
        toolCallId: entry.id,
        toolName: ACP_DISPLAY_TOOL_NAME,
        status: mappedStatus,
        inputText: entry.title,
        // Host 已有工具类型与明细；作为只读展示载荷进入共用分组，不新增协议事实。
        input: entry,
        ...(entry.workflow
          ? {
              display: {
                kind: "create_workflow" as const,
                ok: true,
                errorCount: 0,
                diagnostics: [],
                ...(entry.workflow.graph ? { causalityGraph: entry.workflow.graph } : {}),
              },
            }
          : {}),
        ...(entry.content ? { output: { text: entry.content } } : {}),
        ...(mappedStatus === "error"
          ? { error: { code: "ACP_TOOL_FAILED", message: entry.content || entry.title } }
          : {}),
        ...(unconfirmed ? { error: { code: "ACP_TOOL_UNCONFIRMED", message: entry.status } } : {}),
      });
    }
  }
  return rows;
}
