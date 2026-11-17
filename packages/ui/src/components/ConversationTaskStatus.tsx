import { useStore } from "zustand";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { boardStatusIndicator, isBoardItemStaged } from "@/agent-board/agentBoardModel.js";
import { conversationTaskState, type ConversationTaskSource } from "@/lib/conversationTaskState.js";

const colors = {
  running: "text-brand",
  waiting: "text-interaction-confirmation-foreground",
  completed: "text-success",
  error: "text-destructive",
  staged: "text-foreground-subtle",
};

export function ConversationTaskStatus({ source }: { source: ConversationTaskSource }) {
  const { intl } = useZCodeIntl();
  const item = conversationTaskState(source);
  // 只订阅此任务的派生布尔值，别的任务流式更新和暂存不应重绘全部行。
  const staged = useStore(agentBoardStore, (state) => isBoardItemStaged(item, state.stagedItems));
  const status = boardStatusIndicator({ ...item, staged });
  return (
    <span
      data-conversation-task-status={status}
      className={`shrink-0 whitespace-nowrap text-ui-xs ${colors[status]}`}
    >
      {intl.formatMessage({ id: `agentBoard.status.${status}` })}
    </span>
  );
}
