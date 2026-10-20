import type { WorkTask } from "@zcode/shared";
import type { WorkTaskConversationBinding } from "@/lib/workTaskConversation.js";
import { SessionPane, type SessionPaneProps } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

export type WorkTaskConversationOptions = Pick<
  SessionPaneProps,
  | "isDesktop"
  | "telemetryVisible"
  | "focused"
  | "onOpenBrowserUrl"
  | "onOpenCodeViewer"
  | "onAutoOpenAssistantPptx"
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
> & {
  statusPanel?: Pick<
    SessionPaneProps,
    | "gitSummary"
    | "gitLoading"
    | "gitDirtyFileCount"
    | "gitWorktreeReviewSourceId"
    | "gitWorktreeChangeSummary"
    | "summaryPanelVariantOverride"
    | "onSummaryPanelVariantOverrideChange"
    | "onRefreshGit"
    | "onOpenGitReview"
    | "onOpenWorkspacePath"
  > & { workspaceKey: string };
};
export type OpenWorkTaskNativeSession = (target: {
  workspacePath: string;
  sessionId: string;
}) => void;

export function WorkTaskSessionView({
  task,
  binding,
  options,
  onClose,
  onOpenNativeSession,
  readOnly = false,
}: {
  task: WorkTask;
  binding: WorkTaskConversationBinding;
  options?: WorkTaskConversationOptions;
  onClose(id: string): void;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
  readOnly?: boolean;
}) {
  const scope = { workspacePath: binding.workspacePath };
  const { statusPanel, ...paneOptions } = options ?? {};
  // 修复原因：待办会话漏传宿主 Git 投影；目标切换先于宿主刷新时也不能串入旧工作树数据或操作。
  // gitLoading 由同一宿主投影传入，避免把目标切换后的空 summary 误显示成 Git 不可用。
  const scopedStatusPanel =
    statusPanel?.workspaceKey === (task.workspaceIdentity?.trim() || binding.workspacePath)
      ? statusPanel
      : undefined;
  return (
    <V4PaneConversationProvider scope={scope}>
      <SessionPane
        {...paneOptions}
        {...scopedStatusPanel}
        readOnly={readOnly}
        interactionNotificationsEnabled={false}
        paneId="work-task-conversation"
        workspacePath={binding.workspacePath}
        sessionId={binding.kind === "api" ? binding.sessionId : null}
        acpBoundSessionId={binding.kind === "acp" ? binding.sessionId : undefined}
        acpOpenRequest={
          binding.kind === "acp"
            ? {
                requestId: 1,
                session: {
                  id: binding.sessionId,
                  agent: binding.agent,
                  workspacePath: binding.workspacePath,
                  title: task.title,
                  status:
                    task.status === "running" || task.status === "awaiting_input"
                      ? "running"
                      : "idle",
                  createdAt: task.createdAt,
                  updatedAt: task.updatedAt,
                },
              }
            : null
        }
        openTrigger="sidebar"
        allowWorktreeCreation={false}
        onSessionCreated={
          onOpenNativeSession
            ? (sessionId) => onOpenNativeSession({ ...scope, sessionId })
            : undefined
        }
        onSessionDeleted={() => onClose(task.id)}
        onAcpSessionArchived={(sessionId) => {
          if (sessionId === binding.sessionId) onClose(task.id);
        }}
      />
    </V4PaneConversationProvider>
  );
}
