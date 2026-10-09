import { useEffect } from "react";
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
    const remaining = presentation.expiresAt - Date.now();
    if (!running || activity !== presentation.initialActivity || remaining <= 0) {
      dismiss(presentationKey);
      return;
    }
    // 重挂载只能使用原截止时间的剩余时长，不能重新给同一提示五秒。
    const timer = setTimeout(() => dismiss(presentationKey), remaining);
    return () => clearTimeout(timer);
  }, [warning, presentationKey, presentation, activity, running]);

  // 修复原因：effect 在绘制后执行；首帧就读取消失记录，避免重进会话时旧提示闪现。
  if (
    warning &&
    (!running ||
      !presentation ||
      presentation.dismissed ||
      Date.now() >= presentation.expiresAt ||
      activity !== presentation.initialActivity)
  )
    return null;
  return (
    <div
      role={warning ? "status" : "alert"}
      className="mt-4"
      data-conversation-notice={notice.id}
      data-notice-severity={notice.severity}
    >
      <ChatErrorBanner
        error={{
          code: notice.code,
          message: notice.message,
          ...(notice.detail ? { detail: notice.detail } : {}),
        }}
      />
    </div>
  );
}
