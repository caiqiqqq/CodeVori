import { useLayoutEffect, type ReactNode } from "react";
import type { SessionPaneProps } from "@/v4/SessionPane.js";
import { DialogContent } from "@/components/ui/dialog.js";
import type { WorkTaskWorkspaceToolTarget } from "@/lib/workTaskWorkspaceTools.js";
import type { WorkTaskConversationTools } from "@/work-tasks/WorkTaskConversationPane.js";

export type AgentBoardToolActions = Pick<
  SessionPaneProps,
  | "gitSummary"
  | "gitLoading"
  | "gitDirtyFileCount"
  | "gitWorktreeChangeSummary"
  | "gitWorktreeReviewSourceId"
  | "onRefreshGit"
  | "onOpenGitReview"
  | "onOpenCodeViewer"
  | "onOpenFileLink"
>;

// 详情只提供布局和目标投影；工具状态、菜单与所有类型的渲染均由普通 Shell 持有。
export interface AgentBoardWorkspaceTools {
  target: WorkTaskWorkspaceToolTarget | null;
  onTargetChange(target: WorkTaskWorkspaceToolTarget | null): void;
  isOpen: boolean;
  onToggle(): void;
  actions: AgentBoardToolActions;
  header: WorkTaskConversationTools;
}

export function AgentBoardTools({
  target,
  tools,
  container,
  showCloseButton = false,
  children,
}: {
  target: WorkTaskWorkspaceToolTarget;
  tools?: AgentBoardWorkspaceTools;
  container: HTMLElement | null;
  showCloseButton?: boolean;
  children(actions: AgentBoardToolActions): ReactNode;
}) {
  const onTargetChange = tools?.onTargetChange;
  const {
    taskId,
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    nativeSessionId,
    sidePaneOwnerId,
  } = target;
  useLayoutEffect(() => {
    onTargetChange?.({
      taskId,
      workspacePath,
      workspaceIdentity,
      remoteSessionId,
      nativeSessionId,
      sidePaneOwnerId,
    });
    return () => onTargetChange?.(null);
  }, [
    onTargetChange,
    taskId,
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    nativeSessionId,
    sidePaneOwnerId,
  ]);
  const active = tools?.target;
  const ready =
    active?.taskId === taskId &&
    active.workspacePath === workspacePath &&
    active.workspaceIdentity === workspaceIdentity &&
    active.remoteSessionId === remoteSessionId &&
    active.nativeSessionId === nativeSessionId &&
    active.sidePaneOwnerId === sidePaneOwnerId;
  const open = ready && Boolean(tools?.isOpen);
  return (
    <DialogContent
      portalContainer={container}
      showOverlay={false}
      showCloseButton={showCloseButton}
      data-testid="agent-board-details"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        if (event.target instanceof HTMLElement) event.target.focus();
      }}
      // 非模态详情与普通 Shell 工具并列；工具菜单或文件树获焦不能关闭当前会话。
      onInteractOutside={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => {
        if (open) {
          event.preventDefault();
          tools?.onToggle();
        }
      }}
      className="absolute inset-0 flex h-full w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none"
    >
      <div
        data-testid="agent-board-conversation-column"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      >
        {!tools || ready ? children(tools?.actions ?? {}) : null}
      </div>
    </DialogContent>
  );
}
