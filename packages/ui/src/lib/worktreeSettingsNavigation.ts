import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";

export type WorktreeSettingsConversationTarget =
  | { kind: "api"; workspacePath: string; taskId: string }
  | { kind: "acp"; session: AcpSidebarSession };

let pending: WorktreeSettingsConversationTarget | null = null;
const listeners = new Set<(target: WorktreeSettingsConversationTarget) => void>();

/** 设置页只提交一次导航意图；真正的 session 选择仍由当前聊天壳层执行。 */
export function requestWorktreeSettingsConversation(target: WorktreeSettingsConversationTarget) {
  pending = target;
  for (const listener of listeners) listener(target);
}

export function listenWorktreeSettingsConversation(
  listener: (target: WorktreeSettingsConversationTarget) => void,
): () => void {
  listeners.add(listener);
  if (pending) listener(pending);
  return () => listeners.delete(listener);
}

export function consumeWorktreeSettingsConversation(target: WorktreeSettingsConversationTarget) {
  if (pending === target) pending = null;
}
