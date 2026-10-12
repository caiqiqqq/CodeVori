import type { AcpSession } from "@zcode/shared";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
export { ACP_DISPLAY_TOOL_NAME, acpEntryRowId, buildAcpConversationRows } from "@zcode/shared";

/** footer 只展示时间线尚未表达的操作错误，不修改 Host 保存的诊断。 */
export function acpConversationOperationError(
  session: Pick<AcpSession, "error" | "errorCommandId"> | null,
  error: string | null,
  rows: readonly ConversationRow[],
): string | null {
  if (error && error !== session?.error) return error;
  if (!session?.error) return error;
  // 修复原因：重启恢复只有 session.error，轮尾通过兼容投影显示它；只检查
  // traceError 会重复提示。复用实际投影，同时保留内部操作的 command scope。
  const represented = rows.some(
    (row) =>
      row.kind === "turnHeader" &&
      (session.errorCommandId === undefined || row.turnId === `acp:${session.errorCommandId}`) &&
      row.notices?.some(
        (notice) =>
          notice.severity === "error" && notice.message === session.error?.slice(0, 32_000),
      ),
  );
  return represented ? null : error || session.error;
}
