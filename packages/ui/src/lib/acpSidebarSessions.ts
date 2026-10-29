import {
  acpSessionActivity,
  isAcpHistorySession,
  type AcpAgent,
  type AcpSession,
  type AcpWorkspace,
} from "@zcode/shared";

export interface AcpSidebarSession {
  id: string;
  agent: AcpAgent;
  title: string;
  /** Search results can select the same session before sidebar metadata is available. */
  pinned?: boolean;
  archived?: boolean;
  deletionState?: "pending";
  unreadAt?: number | null;
  status: AcpSession["status"];
  /** Host summary projection; lightweight navigation targets may omit it. */
  failed?: boolean;
  waiting?: boolean;
  boardCompletedAt?: number;
  preview?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AcpConversationOpenRequest {
  requestId: number;
  session: AcpSidebarSession;
}

export interface AcpConversationProjection {
  id: string;
  agent: AcpAgent;
  title: string;
}

/** A read-only list projection: ACP ids never become native taskIds. */
export function projectAcpSidebarSessions(
  sessions: readonly AcpSession[],
  workspace: AcpWorkspace,
): AcpSidebarSession[] {
  const key = workspace.workspaceIdentity?.trim() || workspace.workspacePath;
  return sessions.flatMap((session) => {
    if (
      !isAcpHistorySession(session) ||
      (session.workspaceIdentity?.trim() || session.workspacePath) !== key ||
      session.workspacePath !== workspace.workspacePath
    )
      return [];
    return [
      {
        id: session.id,
        agent: session.agent,
        title: session.title,
        pinned: session.pinned,
        boardCompletedAt: session.boardCompletedAt,
        waiting: Boolean(session.pendingPermission || session.pendingElicitation),
        preview: session.entries.findLast((entry) => entry.kind === "user")?.text?.slice(0, 512),
        archived: session.archived,
        deletionState: session.deletionState,
        unreadAt: session.unreadAt,
        completedAt: session.entries.findLast((entry) => entry.kind === "user")?.endedAt,
        status: session.status,
        // 修复原因：ACP 没有 failed 状态枚举；只有中断且 Host 留有错误才表示失败，主动停止不能亮红点。
        failed: session.status === "interrupted" && Boolean(session.error),
        workspacePath: session.workspacePath,
        ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
        ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
        ...acpSessionActivity(session),
      },
    ];
  });
}
