import { useEffect, useState } from "react";
import { logger } from "@/logger.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import type { BoardItem } from "./agentBoardModel.js";

export function useAgentBoardNotificationSelection({
  rawItems,
  loading,
  error,
  notificationItemKey,
  acknowledgeRead,
  onNotificationItemOpened,
  onNotificationItemMissing,
}: {
  rawItems: BoardItem[];
  loading: boolean;
  error: unknown;
  notificationItemKey?: string;
  acknowledgeRead: (item: BoardItem) => Promise<void>;
  onNotificationItemOpened?: () => void;
  onNotificationItemMissing?: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!notificationItemKey || (loading && !error)) return;
    const item = rawItems.find((row) => row.key === notificationItemKey);
    if (!item || error) {
      onNotificationItemMissing?.();
      return;
    }
    // 修复原因：保存的看板筛选可能遮住通知目标；选中前一次性恢复可见范围。
    agentBoardStore.getState().revealItem(item);
    setSelectedKey(item.key);
    if (item.kind === "work-task") agentBoardStore.getState().markWorkTaskResultRead(item);
    else
      void acknowledgeRead(item).catch((readError: unknown) => {
        logger.warn("[agent-board] 通知目标确认已读失败", { error: readError });
      });
    onNotificationItemOpened?.();
  }, [
    notificationItemKey,
    rawItems,
    loading,
    error,
    acknowledgeRead,
    onNotificationItemOpened,
    onNotificationItemMissing,
  ]);
  return [selectedKey, setSelectedKey] as const;
}
