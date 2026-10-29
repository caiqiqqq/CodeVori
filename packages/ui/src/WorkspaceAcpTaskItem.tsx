import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { acpAgentDefinition, type AcpSessionRowUpdate } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { AcpTaskRowContent } from "@/components/AcpTaskRowContent.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { TaskRenameDialog } from "@/TaskRenameDialog.js";
import { isWorkspaceReadOnly } from "@/store/tabStore.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { useWorkspaceFileManagerAction } from "@/useTaskListItemContextActions.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";
import { buildTaskFeedbackDescription } from "@/lib/taskFeedbackDraft.js";
import { useV4SplitPaneEntry } from "@/v4/splitPaneEntryContext.js";
import { useModelTrajectoryStore } from "@/store/modelTrajectoryStore.js";
import { useTaskRowArchiveConfirmation } from "@/hooks/useTaskRowArchiveConfirmation.js";
import { AgentBoardConversationMenuItem } from "@/agent-board/AgentBoardAddMenuItem.js";

/** The same ACP row and actions appear in workspace, chronological and pinned lists. */
export function WorkspaceAcpTaskItem({
  session,
  service,
  active,
  variant,
  isWorktree = false,
  onSelect,
}: {
  session: AcpSidebarSession;
  service: IServiceAccessor["acpService"];
  active: boolean;
  variant: "timeline" | "default";
  isWorktree?: boolean;
  onSelect: () => void;
}) {
  const { intl } = useZCodeIntl();
  const readOnly = useOptionalTabStore((state) =>
    isWorkspaceReadOnly(state, session.workspacePath, session.workspaceIdentity),
  );
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hoverActionsVisible, setHoverActionsVisible] = useState(false);
  const [focusActionsVisible, setFocusActionsVisible] = useState(false);
  const [isHoverNone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches,
  );
  const itemRef = useRef<HTMLLIElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const openFeedbackSubmit = useFeedbackStore((state) => state.openSubmit);
  const splitPaneEntry = useV4SplitPaneEntry();
  const { fileManagerLabel, openWorkspaceInFileManager, canOpenInFileManager } =
    useWorkspaceFileManagerAction({
      workspacePath: session.workspacePath,
      workspaceIdentity: session.workspaceIdentity,
      remoteSessionId: session.remoteSessionId,
      intl,
    });
  const actionTarget = {
    id: session.id,
    workspacePath: session.workspacePath,
    ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
    ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
  };
  const splitTarget = {
    workspacePath: session.workspacePath,
    ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
    ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
    sessionId: session.id,
    kind: "acp" as const,
    agent: session.agent,
  };

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  async function updateRow(action: AcpSessionRowUpdate["action"], failureMessage: string) {
    if (readOnly || busy) return false;
    setBusy(true);
    try {
      await service.updateRow({ ...actionTarget, action });
      return true;
    } catch (error) {
      // 修复原因：ACP 会话不属于原生 task；动作失败时保留 Host 投影，不能在 UI
      // 里伪造一个已置顶/已改名的任务状态，也不能吞掉远端 Host 的失败。
      logger.warn("[acp-sidebar] 更新会话行失败", { error });
      toast(intl.formatMessage({ id: failureMessage }));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function select() {
    cancelArchiveConfirm();
    onSelect();
    if (session.unreadAt) {
      void updateRow(
        { kind: "unread", unread: false, expectedUnreadAt: session.unreadAt },
        "taskList.markAsUnreadFailed",
      );
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      logger.warn("[acp-sidebar] 复制会话信息失败", { error });
    }
  }

  async function copySessionPath() {
    try {
      // 修复原因：路径在目标 Host 上解析，菜单打开不等待 RPC，也不能把远端
      // 会话 ID 推导成当前机器的本地路径。
      const path = await service.getSessionFilePath(actionTarget);
      await copy(path);
    } catch (error) {
      logger.warn("[acp-sidebar] 读取 Host 会话文件路径失败", { error });
      toast(intl.formatMessage({ id: "taskList.acpCopySnapshotFailed" }));
    }
  }
  async function copyDiagnosticPath() {
    try {
      await copy(await service.getDiagnosticLogPath(actionTarget));
    } catch (error) {
      logger.warn("[acp-sidebar] 读取 Host 诊断日志路径失败", { error });
      toast(intl.formatMessage({ id: "taskList.acpCopyLogFailed" }));
    }
  }

  const pinLabel = intl.formatMessage({ id: session.pinned ? "taskList.unpin" : "taskList.pin" });
  const pinAction = () => {
    cancelArchiveConfirm();
    void updateRow({ kind: "pin", pinned: !session.pinned }, "taskList.pinFailed");
  };
  // 修复原因：ACP 之前只有右键归档入口；行内按钮与菜单必须复用同一 scoped Host 命令。
  function archiveAction() {
    void updateRow({ kind: "archive", archived: true }, "taskList.archiveFailed");
  }
  const {
    confirming: isArchiveConfirming,
    cancel: cancelArchiveConfirm,
    onClick: archiveInline,
  } = useTaskRowArchiveConfirmation({
    itemRef,
    disabled: readOnly || busy,
    onConfirm: archiveAction,
  });
  // 修复原因：Host 中断且有错误才是失败；失败必须盖过未读，主动停止不应显示红点。
  const leadingIndicator = session.failed
    ? "error"
    : typeof session.unreadAt === "number"
      ? "unread"
      : session.status === "running"
        ? "loading"
        : "none";
  // 修复原因：置顶与归档移到同一右侧 action 组，左侧品牌和状态在 hover/focus 时仍保留。
  const showRowActions =
    hoverActionsVisible || focusActionsVisible || isHoverNone || isArchiveConfirming;
  const showPinAction = showRowActions || (Boolean(session.pinned) && !isWorktree);
  const showArchiveAction = !readOnly && showRowActions;
  const pinDisabledReason = readOnly
    ? intl.formatMessage({ id: "workspaceSidebar.unavailableLocalDirectory" })
    : busy
      ? intl.formatMessage({ id: "common.loading" })
      : undefined;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            ref={itemRef}
            data-testid={`acp-task-item-${session.id}`}
            data-acp-session-id={session.id}
            data-acp-pinned={session.pinned ? "true" : undefined}
            role="button"
            aria-label={`${session.title}, ${acpAgentDefinition(session.agent).name}${session.failed ? `, ${intl.formatMessage({ id: "taskList.status.failed" })}` : ""}`}
            aria-description={
              isWorktree
                ? `${intl.formatMessage({ id: "taskList.worktreeConversation" })}: ${session.workspacePath}`
                : undefined
            }
            aria-current={active ? "page" : undefined}
            data-selected={active}
            tabIndex={0}
            onClick={select}
            onMouseEnter={() => setHoverActionsVisible(true)}
            onMouseLeave={() => setHoverActionsVisible(false)}
            onFocusCapture={() => setFocusActionsVisible(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFocusActionsVisible(false);
                cancelArchiveConfirm();
              }
            }}
            onContextMenu={(event) => {
              event.stopPropagation();
              cancelArchiveConfirm();
            }}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                select();
              }
            }}
            className={cn(
              "sidebar-conversation-row group/acp-task flex cursor-pointer items-center gap-2 rounded-lg pl-2.5 pr-1 py-1 text-ui-base transition-colors",
              variant === "timeline" && "items-start py-1.5",
              !active && "hover:bg-surface-hover",
            )}
          >
            <div
              className={cn(
                "relative flex size-4 shrink-0 items-center justify-center",
                variant === "timeline" && "mt-0.5",
              )}
            >
              <span
                aria-hidden="true"
                className="relative flex size-4 items-center justify-center transition-opacity"
              >
                <AcpAgentIcon agent={session.agent} />
                {leadingIndicator === "error" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-card">
                    <span
                      data-error-indicator="true"
                      className="size-1.5 rounded-full bg-destructive"
                    />
                  </span>
                ) : leadingIndicator === "unread" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-card">
                    <span
                      data-unread-indicator="true"
                      className="size-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
                    />
                  </span>
                ) : leadingIndicator === "loading" ? (
                  // 调整依据：与 API 行统一缩小到 10px，保留原有圆环样式及品牌底色隔离。
                  <span className="absolute -bottom-1 -right-1 flex size-2.5 items-center justify-center rounded-full bg-card ring-2 ring-card">
                    <LoaderCircle
                      data-acp-running-indicator="true"
                      strokeWidth={3}
                      className="size-2.5 animate-spin text-task-running-indicator"
                    />
                  </span>
                ) : null}
              </span>
            </div>
            <AcpTaskRowContent
              session={session}
              variant={variant}
              showWorktreeIndicator={isWorktree && !showRowActions}
              showPin={showPinAction}
              pinDisabledReason={pinDisabledReason}
              showArchive={showArchiveAction}
              confirming={isArchiveConfirming}
              busy={busy}
              onPinClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // 修复原因：禁用聚焦按钮可能不触发冒泡 blur；先交回行焦点，避免残留 focus action。
                if (event.currentTarget === document.activeElement) {
                  itemRef.current?.focus();
                }
                pinAction();
              }}
              onClick={archiveInline}
            />
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52" data-testid={`acp-task-menu-${session.id}`}>
          <AgentBoardConversationMenuItem target={{ ...session, kind: "acp" }} />
          <ContextMenuItem disabled={readOnly || busy} onSelect={pinAction}>
            {pinLabel}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={readOnly || busy}
            onSelect={() => {
              setRenameDraft(session.title);
              setRenaming(true);
            }}
          >
            {intl.formatMessage({ id: "taskList.rename" })}
          </ContextMenuItem>
          <ContextMenuItem disabled={readOnly || busy} onSelect={archiveAction}>
            {intl.formatMessage({ id: "taskList.archive" })}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={readOnly || busy}
            onSelect={() =>
              void updateRow({ kind: "unread", unread: true }, "taskList.markAsUnreadFailed")
            }
          >
            {intl.formatMessage({ id: "taskList.markAsUnread" })}
          </ContextMenuItem>
          {splitPaneEntry.enabled ? (
            <ContextMenuItem
              disabled={!splitPaneEntry.canOpenSession(splitTarget)}
              onSelect={() => splitPaneEntry.openSession(splitTarget)}
            >
              {intl.formatMessage({ id: "taskList.openInSplitPane" })}
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canOpenInFileManager}
            onSelect={() => void openWorkspaceInFileManager()}
          >
            {fileManagerLabel}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copy(session.workspacePath)}>
            {intl.formatMessage({ id: "appHeader.copyPath" })}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copySessionPath()}>
            {intl.formatMessage({ id: "appHeader.copyTaskPath" })}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyDiagnosticPath()}>
            {intl.formatMessage({ id: "appHeader.copyLogPath" })}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copy(session.id)}>
            {intl.formatMessage({ id: "appHeader.copySessionId" })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              useModelTrajectoryStore.getState().requestOpen({
                taskId: session.id,
                workspaceKey: session.workspaceIdentity?.trim() || session.workspacePath,
                title: session.title,
                source: "acp",
              })
            }
          >
            {intl.formatMessage({ id: "taskList.viewModelTrajectory" })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              // 修复原因：ACP 反馈复用同一个反馈表单，但 ID 是 Host ACP 快照 ID；
              // 不提供不存在的原生 CLI 日志路径或调用轨迹。
              openFeedbackSubmit({
                title: intl
                  .formatMessage(
                    { id: "feedback.submit.template.section.taskFeedbackTitle" },
                    { title: session.title },
                  )
                  .slice(0, 80),
                type: "bug",
                module: "Agent任务执行失败",
                severity: "P2-中",
                includeLogs: false,
                description: buildTaskFeedbackDescription({
                  taskTitle: `${acpAgentDefinition(session.agent).name} ACP: ${session.title}`,
                  taskId: session.id,
                  workspacePath: session.workspacePath,
                  formatMessage: (id, values) => intl.formatMessage({ id }, values),
                }),
                screenshots: [],
              });
              toast(intl.formatMessage({ id: "taskList.feedbackOpened" }));
            }}
          >
            {intl.formatMessage({ id: "taskList.feedback" })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <TaskRenameDialog
        open={renaming}
        value={renameDraft}
        inputRef={renameInputRef}
        intl={intl}
        onOpenChange={(open) => {
          if (!open) setRenaming(false);
        }}
        onChange={setRenameDraft}
        onCancel={() => setRenaming(false)}
        onConfirm={() => {
          if (!renameDraft.trim()) return;
          if (renameDraft.trim() === session.title) {
            setRenaming(false);
            return;
          }
          void updateRow({ kind: "rename", title: renameDraft }, "taskList.renameFailed").then(
            (ok) => {
              if (ok) setRenaming(false);
            },
          );
        }}
      />
    </>
  );
}
