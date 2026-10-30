import type { BoardItem } from "./agentBoardModel.js";
import { SessionPane, type SessionPaneProps } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import { useMemo } from "react";
import type { AgentBoardToolActions } from "./AgentBoardTools.js";

export type BoardConversationOptions = Pick<
  SessionPaneProps,
  | "isDesktop"
  | "onOpenBrowserUrl"
  | "onOpenCodeViewer"
  | "onOpenFileLink"
  | "onOpenBackgroundBash"
  | "onOpenSubagentSession"
  | "onOpenSubagentDirectory"
  | "onSyncSubagentSessionTabs"
  | "onOpenSelectionSideChat"
  | "onOpenPlanDetail"
  | "onOpenWorkflowRun"
  | "onOpenWorkflowArtifact"
  | "onOpenWorkflowRunDirectory"
  | "onOpenWorkflowActorSession"
  | "onOpenWorkflowWorkspace"
>;
export function AgentBoardConversation({
  item,
  options,
  git,
  onClose,
}: {
  item: Exclude<BoardItem, { kind: "work-task" }>;
  options?: BoardConversationOptions;
  git: AgentBoardToolActions;
  onClose(): void;
}) {
  const scope = useMemo(
    () => ({
      workspacePath: item.workspacePath,
      workspaceIdentity: item.workspaceIdentity,
      remoteSessionId: item.remoteSessionId,
    }),
    [item.workspacePath, item.workspaceIdentity, item.remoteSessionId],
  );
  return (
    <V4PaneConversationProvider scope={scope}>
      <SessionPane
        {...options}
        {...git}
        activeTaskChangeSummary={item.kind === "native" ? item.task.changeSummary : undefined}
        paneId="agent-board-conversation"
        workspacePath={item.workspacePath}
        workspaceIdentity={item.workspaceIdentity}
        remoteSessionId={item.remoteSessionId}
        sessionId={item.kind === "native" ? item.task.taskId : null}
        acpBoundSessionId={item.kind === "acp" ? item.session.id : undefined}
        acpOpenRequest={item.kind === "acp" ? { requestId: 1, session: item.session } : null}
        readOnly={!item.online || item.archived}
        interactionNotificationsEnabled={false}
        allowWorktreeCreation={false}
        openTrigger="sidebar"
        onSessionDeleted={onClose}
        onAcpSessionArchived={onClose}
      />
    </V4PaneConversationProvider>
  );
}
