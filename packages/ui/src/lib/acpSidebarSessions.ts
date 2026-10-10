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
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  createdAt: number;
  updatedAt: number;
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
        archived: session.archived,
        deletionState: session.deletionState,
        unreadAt: session.unreadAt,
        status: session.status,
        workspacePath: session.workspacePath,
        ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
        ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
        ...acpSessionActivity(session),
      },
    ];
  });
}
