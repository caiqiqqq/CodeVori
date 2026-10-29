import { AgentBoardPreview } from "./AgentBoardPreview.js";
import type { BoardItem } from "./agentBoardModel.js";
import { SessionPane, type SessionPaneProps } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import { useMemo } from "react";
import { usePaneGitStatus, type OpenScopedGitReview } from "@/hooks/usePaneGitStatus.js";

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
> & { onOpenScopedGitReview?: OpenScopedGitReview };
export function AgentBoardConversation({
  item,
  options,
  onClose,
}: {
  item: Exclude<BoardItem, { kind: "work-task" }>;
  options?: BoardConversationOptions;
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
  const { onOpenScopedGitReview, ...paneOptions } = options ?? {};
  // 看板跨项目打开会话，不能遗漏 Git 投影，也不能复用 Shell 当前项目的闭包。
  const git = usePaneGitStatus(scope, item.online, onOpenScopedGitReview);
  return (
    <V4PaneConversationProvider scope={scope}>
      <AgentBoardPreview scope={scope} onOpenBrowserUrl={options?.onOpenBrowserUrl}>
        {(preview) => (
          <SessionPane
            {...paneOptions}
            {...preview}
            {...git}
            activeTaskChangeSummary={item.kind === "native" ? item.task.changeSummary : undefined}
            onOpenGitReview={
              git.onOpenGitReview
                ? (sourceId) => {
                    onClose();
                    git.onOpenGitReview?.(sourceId);
                  }
                : undefined
            }
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
        )}
      </AgentBoardPreview>
    </V4PaneConversationProvider>
  );
}
