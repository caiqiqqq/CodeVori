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
>;
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
}: {
  task: WorkTask;
  binding: WorkTaskConversationBinding;
  options?: WorkTaskConversationOptions;
  onClose(id: string): void;
  onOpenNativeSession?: OpenWorkTaskNativeSession;
}) {
  const scope = { workspacePath: binding.workspacePath };
  return (
    <V4PaneConversationProvider scope={scope}>
      <SessionPane
        {...options}
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
