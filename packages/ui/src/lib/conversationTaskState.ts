import type { WorkTask, ZCodeTaskMeta } from "@zcode/shared";
import type { AcpSidebarSession } from "./acpSidebarSessions.js";
import { getTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import {
  acpBoardStatus,
  boardEntityKey,
  nativeBoardStatus,
  workTaskBoardStatus,
  type BoardTaskState,
} from "@/agent-board/agentBoardModel.js";

export type ConversationTaskSource =
  | { kind: "native"; item: ZCodeTaskMeta }
  | { kind: "acp"; item: AcpSidebarSession }
  | { kind: "work-task"; item: WorkTask };

/** 看板和侧栏只派生同一任务状态，不创建第二份调度或持久化事实。 */
export function conversationTaskState(source: ConversationTaskSource): BoardTaskState {
  const { item, kind } = source;
  const common = {
    key: boardEntityKey(item, kind, source.kind === "native" ? source.item.taskId : source.item.id),
    updatedAt: item.updatedAt,
    archived: "archived" in item && item.archived === true,
  };
  if (source.kind === "work-task")
    return {
      ...common,
      kind: source.kind,
      workTask: source.item,
      status: workTaskBoardStatus(source.item),
    };
  if (source.kind === "acp")
    return { ...common, kind: source.kind, status: acpBoardStatus(source.item) };
  return {
    ...common,
    kind: "native",
    status: nativeBoardStatus({
      pendingInteraction: source.item.pendingInteraction,
      activity: getTaskListRowActivity(source.item),
      status: source.item.status,
    }),
  };
}
