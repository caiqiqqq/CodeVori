import { useEffect, useRef, useState } from "react";
import { LoaderIcon, Pin } from "lucide-react";
import { acpAgentDefinition, type AcpSessionRowUpdate } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
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

/** The same ACP row and actions appear in workspace, chronological and pinned lists. */
export function WorkspaceAcpTaskItem({
  session,
  service,
  active,
  variant,
  onSelect,
}: {
  session: AcpSidebarSession;
  service: IServiceAccessor["acpService"];
  active: boolean;
  variant: "timeline" | "default";
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
  const timeLabel = session.updatedAt > 0 ? formatTaskRelativeTime(session.updatedAt, intl) : null;
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
    onSelect();
    if (session.unreadAt) {
      void updateRow({ kind: "unread", unread: false }, "taskList.markAsUnreadFailed");
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
  const pinAction = () =>
    void updateRow({ kind: "pin", pinned: !session.pinned }, "taskList.pinFailed");
  // 修复原因：API 项目列表普通状态留空，只有时间线显示空闲灰点；
  // ACP 原先所有布局都显示灰点，且运行态覆盖未读。按同一优先级投影 Host 字段。
  const leadingIndicator =
    typeof session.unreadAt === "number"
      ? "unread"
      : session.status === "running"
        ? "loading"
        : "none";
  const showTimelineIdleIndicator =
    variant === "timeline" && leadingIndicator === "none" && !session.pinned;
  // 修复原因：API 会话在左侧 16px 状态槽展示置顶；ACP 原来额外在右侧
  // 放按钮，导致两种行的位置不一致。悬停/聚焦共用状态槽，标题不发生位移。
  const showPinAction =
    hoverActionsVisible || focusActionsVisible || (session.pinned && leadingIndicator === "none");

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            data-testid={`acp-task-item-${session.id}`}
            data-acp-session-id={session.id}
            data-acp-pinned={session.pinned ? "true" : undefined}
            role="button"
            aria-current={active ? "page" : undefined}
            tabIndex={0}
            onClick={select}
            onMouseEnter={() => setHoverActionsVisible(true)}
            onMouseLeave={() => setHoverActionsVisible(false)}
            onFocusCapture={() => setFocusActionsVisible(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFocusActionsVisible(false);
              }
            }}
            onContextMenu={(event) => event.stopPropagation()}
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
              "group/acp-task flex cursor-pointer items-center gap-2 rounded-lg pl-2.5 pr-1 py-1 text-ui-base transition-colors",
              variant === "timeline" && "items-start py-1.5",
              active ? "bg-selected" : "hover:bg-surface-hover",
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
                className={cn(
                  "flex size-4 items-center justify-center transition-opacity",
                  showPinAction && "hidden",
                )}
              >
                {leadingIndicator === "unread" ? (
                  <span
                    data-unread-indicator="true"
                    className="size-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
                  />
                ) : leadingIndicator === "loading" ? (
                  <LoaderIcon className="size-4 animate-spin text-foreground-subtle" />
                ) : showTimelineIdleIndicator ? (
                  <span data-idle-indicator="true" className="size-1.5 rounded-full bg-border" />
                ) : null}
              </span>
              {showPinAction ? (
                <ControlHintTooltip title={pinLabel} side="top" align="center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={readOnly || busy}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      pinAction();
                    }}
                    className="inline-flex size-4 min-w-0 rounded-sm p-0 text-foreground-subtle !bg-transparent hover:text-foreground"
                    aria-label={pinLabel}
                    data-testid={`acp-task-pin-${session.id}`}
                  >
                    <Pin className="size-4" />
                  </Button>
                </ControlHintTooltip>
              ) : null}
            </div>
            <span
              className={cn(
                "flex min-w-0 flex-1",
                variant === "timeline" ? "flex-col gap-0.5" : "items-center gap-2",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-foreground" title={session.title}>
                {session.title}
              </span>
              <span
                className={cn(
                  "flex items-center gap-2 text-foreground-subtle",
                  variant === "timeline"
                    ? "h-6 justify-between text-ui-base"
                    : "shrink-0 text-ui-sm",
                )}
              >
                <span className="min-w-0 truncate">{acpAgentDefinition(session.agent).name}</span>
                {timeLabel ? (
                  <span className="shrink-0" data-testid="acp-task-time">
                    {timeLabel}
                  </span>
                ) : null}
              </span>
            </span>
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52" data-testid={`acp-task-menu-${session.id}`}>
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
          <ContextMenuItem
            disabled={readOnly || busy}
            onSelect={() =>
              void updateRow({ kind: "archive", archived: true }, "taskList.archiveFailed")
            }
          >
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
