import { useEffect, useState } from "react";
import type { TurnHeaderRow } from "@zcode/shared/zcode-protocol-v4";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";

type Notice = NonNullable<TurnHeaderRow["notices"]>[number];

/** 只拥有提示的本地显隐，不修改 Host 保存的诊断或恢复状态。 */
export function ConversationTurnNotice({
  notice,
  activity,
  running,
}: {
  notice: Notice;
  activity: string;
  running: boolean;
}) {
  const warning = notice.severity === "warning";
  const [initialActivity] = useState(activity);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!warning) return;
    // 普通提示只短暂展示；这个计时器不参与连接恢复判断，恢复由已接纳内容变化立即清除。
    const timer = setTimeout(() => setExpired(true), 5000);
    return () => clearTimeout(timer);
  }, [warning]);

  if (warning && (!running || expired || activity !== initialActivity)) return null;
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
