import {
  boardEntityKey,
  matchesBoardTracking,
  type BoardItem,
  type BoardTracking,
} from "../agent-board/agentBoardModel.js";
import type { WorktreeSettingsConversationTarget } from "./worktreeSettingsNavigation.js";

export function findNotificationBoardItem(
  target: WorktreeSettingsConversationTarget,
  items: readonly BoardItem[],
  tracking: BoardTracking,
): BoardItem | undefined {
  if (target.kind === "api-notification") {
    const matches = items.filter(
      (item) =>
        item.kind === "native" &&
        item.task.taskId === target.taskId &&
        matchesBoardTracking(item, tracking),
    );
    // 旧 IPC 只有 taskId；跨 workspace 重名时不能猜测要打开哪一个。
    return matches.length === 1 ? matches[0] : undefined;
  }
  const scope =
    target.kind === "acp" ? target.session : target.kind === "work-task" ? target.scope : target;
  const id =
    target.kind === "acp"
      ? target.session.id
      : target.kind === "work-task"
        ? target.id
        : target.taskId;
  const kind = target.kind === "api" ? "native" : target.kind;
  const key = boardEntityKey(scope, kind, id);
  return items.find(
    (item) =>
      item.key === key &&
      item.workspacePath === scope.workspacePath &&
      (!("remoteSessionId" in scope) ||
        !scope.remoteSessionId ||
        item.remoteSessionId === scope.remoteSessionId) &&
      matchesBoardTracking(item, tracking),
  );
}
