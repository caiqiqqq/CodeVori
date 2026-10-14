import { isDeepStrictEqual } from "node:util";
import {
  isWorkTaskMerging,
  workTaskExecutionPath,
  type WorkTask,
  type WorkTaskUpdate,
  type WorkTaskCreate,
} from "@zcode/shared";
import type { WorkTaskConversationEvent } from "./workTask.js";

export function assertWorkTaskWorkspaceEditable(
  task: WorkTask | null,
  input: WorkTaskUpdate | WorkTaskCreate,
) {
  if (input.useWorktree === false && !input.sourceBranch)
    throw new Error("work-task.source-branch-required");
  if (!task) return;
  if (
    task.runSeq > 0 &&
    (input.execution.kind !== task.execution.kind ||
      (input.execution.kind === "acp" &&
        task.execution.kind === "acp" &&
        input.execution.agent !== task.execution.agent))
  )
    throw new Error("work-task.executor-locked");
  if (!task.worktree && !task.directBranch) return;
  if (input.sourceBranch !== task.sourceBranch) throw new Error("work-task.source-branch-locked");
  if ((input.useWorktree !== false) !== (task.useWorktree !== false))
    throw new Error("work-task.execution-workspace-locked");
}

export function workTaskRunPrompt(task: WorkTask, feedback?: string) {
  // 文字追问不是原始描述的重发；失败重试则保留该轮的附件归属。
  if (feedback) return { runText: feedback, runUsesPromptAssets: false };
  return {
    runText: task.status === "todo" ? task.prompt : task.runText,
    runUsesPromptAssets: task.status === "todo" ? true : task.runUsesPromptAssets,
  };
}

export function assertNewSessionRestart(task: WorkTask, owner: string | null, feedback?: string) {
  if (
    feedback ||
    owner ||
    task.archived ||
    task.stopPending ||
    task.worktreeCleanup?.phase === "running" ||
    task.status !== "failed" ||
    !task.session ||
    task.session.kind !== task.execution.kind ||
    isWorkTaskMerging(task)
  )
    throw new Error("work-task.new-session-unavailable");
}

export function continueWorkTaskConversation(
  current: WorkTask,
  watched: WorkTask,
  event: WorkTaskConversationEvent,
  owner: string | null,
  now: number,
): WorkTask | null {
  // 已完成会话仍可继续；只认领真实新轮，不重新入队或重发，旧命令不能撤销完成。
  if (
    owner ||
    isWorkTaskMerging(current) ||
    current.archived ||
    current.stopPending ||
    !current.session ||
    !workTaskExecutionPath(current) ||
    !["failed", "review", "done"].includes(current.status) ||
    (event.status !== "running" && event.status !== "awaiting_input") ||
    event.commandId === current.commandId ||
    event.startedAt < current.updatedAt ||
    !isDeepStrictEqual(watched.session, current.session) ||
    !isDeepStrictEqual(watched.worktree, current.worktree) ||
    watched.directBranch !== current.directBranch
  )
    return null;
  return {
    ...current,
    status: event.status,
    commandId: event.commandId,
    runSeq: current.runSeq + 1,
    failureReason: undefined,
    completion: undefined,
    merge: undefined,
    // 清理失败属于上一轮；真实新命令认领成功后必须同步清除，否则 UI 会遮盖新轮状态。
    worktreeCleanup: undefined,
    updatedAt: now,
  };
}
