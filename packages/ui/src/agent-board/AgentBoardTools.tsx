import { useLayoutEffect, type ReactNode } from "react";
import type { SessionPaneProps } from "@/v4/SessionPane.js";
import { cn } from "@/components/lib/utils.js";
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
      // 只有外部主键点击关闭聊天；切焦和原 Shell 工具操作不能撤销当前会话 target。
      onFocusOutside={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => {
        // Portal 弹出层虽不在聊天/工具 DOM 内，也应先完成自身交互。
        const inWorkspaceSurface =
          event.target instanceof Element &&
          event.target.closest(
            '[data-workspace-side-frame], [data-workspace-side-pane-resize-handle], [data-workspace-terminal-frame], [data-workspace-terminal-resize-handle], [data-slot="popover-content"]',
          );
        if (event.detail.originalEvent.button !== 0 || inWorkspaceSurface) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (open) {
          event.preventDefault();
          tools?.onToggle();
        }
      }}
      // 看板入口先保留左侧卡片；只有原工具 owner 展开后才占满会话列。
      className={cn(
        "absolute inset-y-0 right-0 flex h-full w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0",
        open
          ? "left-0 max-w-full border-0 shadow-none"
          : "left-auto max-w-160 border-0 border-l border-border shadow-xl",
      )}
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
