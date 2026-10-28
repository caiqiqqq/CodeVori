import type { AcpEntry, AcpSession } from "./zcode-protocol/acp.js";
import type { ConversationRow, ToolCallRow } from "./zcode-protocol-v4/index.js";
export const ACP_DISPLAY_TOOL_NAME = "ACP external tool";

/** 展示用工具身份与 ZCode CLI 工具名隔离，避免 Read/Task 等误入原生能力卡。 */

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
  session:
    | (Pick<AcpSession, "entries" | "status"> &
        Partial<Pick<AcpSession, "error" | "errorCommandId">>)
    | null,
  startIndex = 0,
): ConversationRow[] {
  if (!session) return [];
  const { entries, status } = session;
  const lastUserIndex = entries.findLastIndex((entry) => entry.kind === "user");
  const lastAssistantIndex = entries.findLastIndex((entry) => entry.kind === "assistant");
  const rows: ConversationRow[] = [];
  let turnId = "acp:orphan";
  let turnFailed = false;
  for (const [index, entry] of entries.entries()) {
    if (entry.kind === "user") {
      turnId = `acp:${entry.id.startsWith("user:") ? entry.id.slice(5) : entry.id}`;
      turnFailed = Boolean(
        entry.traceError ||
        entry.failures?.some((failure) => failure.severity === "error") ||
        (index === lastUserIndex &&
          status === "interrupted" &&
          session.error &&
          (session.errorCommandId === undefined || entry.id === `user:${session.errorCommandId}`)),
      );
    }
    if (index < startIndex) continue;
    const createdAt = entry.createdAt ?? 0;
    const isLastTurn = lastUserIndex < 0 || index >= lastUserIndex;
    if (entry.kind === "user" || index === 0) {
      const failures = entry.kind === "user" ? entry.failures : undefined;
      const legacyError =
        entry.kind === "user"
          ? entry.traceError ||
            (isLastTurn &&
            status === "interrupted" &&
            (session.errorCommandId === undefined || entry.id === `user:${session.errorCommandId}`)
              ? session.error
              : null)
          : null;
      const reportedNotices =
        failures
          ?.filter((failure) => {
            // 修复原因：已保存的警告不是持续错误；结束或历史回放不能把重连中等临时提示再次挂到轮尾。
            if (failure.severity === "error") return true;
            if (!isLastTurn || status !== "running") return false;
            // 同类重连可能每次使用不同 id；只投影最后一条状态，避免错误卡片堆叠。
            // 确认失败后同类警告失效，但 Host 的完整诊断仍原样保存。
            return (
              !failures.some(
                (item) => item.category === failure.category && item.severity === "error",
              ) && failures.findLast((item) => item.category === failure.category) === failure
            );
          })
          .map((failure) => ({
            id: failure.id,
            severity: failure.severity,
            code: failure.severity === "error" ? "ACP_SESSION_FAILED" : "ACP_SESSION_WARNING",
            message: failure.title,
            ...(failure.details ? { detail: failure.details } : {}),
          })) ?? [];
      const notices =
        legacyError && !reportedNotices.some((notice) => notice.severity === "error")
          ? [
              ...reportedNotices.slice(-63),
              {
                id: entry.id.slice(0, 512),
                severity: "error" as const,
                code: "ACP_SESSION_FAILED",
                message: legacyError.slice(0, 32_000),
              },
            ]
          : reportedNotices;
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
            : turnFailed
              ? "failed"
              : isLastTurn && status === "interrupted"
                ? "completedInterrupted"
                : "completedSuccess",
        startedAt: createdAt,
        ...(entry.kind === "user" && entry.createdAt !== undefined && entry.endedAt !== undefined
          ? { endedAt: entry.endedAt }
          : {}),
        ...(notices.length ? { notices } : {}),
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
        ...(entry.id.startsWith("user:") ? { sourceCommandId: entry.id.slice(5) } : {}),
        text: displayText(entry),
        ...(entry.attachments?.length ? { attachments: entry.attachments } : {}),
      });
    } else if (entry.kind === "assistant") {
      rows.push({
        ...base,
        kind: "assistantText",
        text: entry.text,
        state:
          turnFailed && (!isLastTurn || status !== "running")
            ? "failed"
            : isLastTurn && index === lastAssistantIndex
              ? status === "running"
                ? index === entries.length - 1
                  ? "streaming"
                  : "complete"
                : status === "interrupted"
                  ? "interrupted"
                  : "complete"
              : "complete",
      });
    } else if (entry.kind === "thought") {
      rows.push({
        ...base,
        kind: "reasoning",
        text: entry.text,
        state:
          entry.state === "streaming" && (!isLastTurn || status !== "running")
            ? "interrupted"
            : entry.state,
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      });
    } else if (entry.kind === "plan") {
      rows.push({ ...base, kind: "plan", planId: entry.id, entries: entry.entries });
    } else if (entry.kind === "compaction") {
      rows.push({
        ...base,
        kind: "timelineMarker",
        lane: "assistantWork",
        marker: {
          type: "compact",
          // 只有 Agent 明确报告 auto 才显示自动压缩；未知来源复用中性的完成文案。
          origin: entry.origin ?? "manual",
          status:
            entry.status === "running" && (!isLastTurn || status !== "running")
              ? "cancelled"
              : entry.status,
          ...(entry.tokensBefore !== undefined ? { tokensBefore: entry.tokensBefore } : {}),
          ...(entry.tokensAfter !== undefined ? { tokensAfter: entry.tokensAfter } : {}),
        },
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
