import { useEffect } from "react";
import { InfoIcon } from "lucide-react";
import type { TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";
import { useConversationWarningPresentationStore } from "@/store/conversationWarningPresentationStore.js";

type Notice = NonNullable<TurnHeaderRow["notices"]>[number];

/** 从 UI store 读取提示显隐，不修改 Host 保存的诊断或恢复状态。 */
export function ConversationTurnNotice({
  presentationKey,
  notice,
  activity,
  running,
}: {
  presentationKey: string;
  notice: Notice;
  activity: string;
  running: boolean;
}) {
  const warning = notice.severity === "warning";
  const presentation = useConversationWarningPresentationStore((state) =>
    warning ? state.presentations[presentationKey] : undefined,
  );
  useEffect(() => {
    if (!warning) return;
    const { begin, dismiss } = useConversationWarningPresentationStore.getState();
    if (!presentation) {
      begin(presentationKey, activity, running);
      return;
    }
    if (presentation.dismissed) return;
    // 重连耗时无法预估；仅以本轮恢复输出或结束作为清除依据，不能用固定超时伪装恢复。
    if (!running || activity !== presentation.initialActivity) {
      dismiss(presentationKey);
    }
  }, [warning, presentationKey, presentation, activity, running]);

  // 修复原因：effect 在绘制后执行；首帧就读取消失记录，避免重进会话时旧提示闪现。
  if (
    warning &&
    (!running ||
      !presentation ||
      presentation.dismissed ||
      activity !== presentation.initialActivity)
  )
    return null;
  return (
    <div
      role={warning ? "status" : "alert"}
      className={
        warning ? "mt-2 flex min-w-0 items-start gap-2 text-ui-sm text-foreground-subtle" : "mt-4"
      }
      data-conversation-notice={notice.id}
      data-notice-severity={notice.severity}
    >
      {/* 修复原因：自动恢复中的 warning 不是失败，不能复用带复制按钮的整宽错误卡片。 */}
      {warning ? (
        <>
          <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {notice.message}
          </span>
        </>
      ) : (
        <ChatErrorBanner
          error={{
            code: notice.code,
            message: notice.message,
            ...(notice.detail ? { detail: notice.detail } : {}),
          }}
        />
      )}
    </div>
  );
}
