import { isDeepStrictEqual } from "node:util";
import type { WorkTask } from "@zcode/shared";
import type { WorkTaskConversationEvent } from "./workTask.js";

export function continueWorkTaskConversation(
  current: WorkTask,
  watched: WorkTask,
  event: WorkTaskConversationEvent,
  owner: string | null,
  now: number,
): WorkTask | null {
  // 普通输入框已执行新轮；只认领观察，不重新入队或重发，旧命令不能复活终态。
  if (
    owner ||
    current.archived ||
    current.stopPending ||
    !current.session ||
    !current.worktree ||
    !["failed", "review"].includes(current.status) ||
    (event.status !== "running" && event.status !== "awaiting_input") ||
    event.commandId === current.commandId ||
    event.startedAt < current.updatedAt ||
    !isDeepStrictEqual(watched.session, current.session) ||
    !isDeepStrictEqual(watched.worktree, current.worktree)
  )
    return null;
  return {
    ...current,
    status: event.status,
    commandId: event.commandId,
    runSeq: current.runSeq + 1,
    failureReason: undefined,
    updatedAt: now,
  };
}
