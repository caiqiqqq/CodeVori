import type { MouseEvent } from "react";
import { Archive, CloudUpload, Pin } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { WorktreeConversationIndicator } from "@/components/WorktreeConversationIndicator.js";
import { TaskRowActionButton } from "@/workspace-grouped-tasks/task-row-action-button.js";

/** 复用原生右侧置顶/归档控件；确认状态和 scoped Host 动作由会话行唯一持有。 */
export function AcpTaskRowContent({
  session,
  variant,
  showWorktreeIndicator,
  showPin,
  pinDisabledReason,
  showArchive,
  confirming,
  busy,
  onPinClick,
  onClick,
}: {
  session: AcpSidebarSession;
  variant: "default" | "timeline";
  showWorktreeIndicator: boolean;
  showPin: boolean;
  pinDisabledReason?: string;
  showArchive: boolean;
  confirming: boolean;
  busy: boolean;
  onPinClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({
    id: confirming ? "common.confirm" : "taskList.archive",
  });
  return (
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
          // 修复原因：归档控件高 24px；元信息预留同一高度，避免 hover 时行高变化让列表跳动。
          "flex h-6 items-center gap-2 text-foreground-subtle",
          variant === "timeline" ? "justify-end text-ui-base" : "shrink-0 text-ui-sm",
        )}
      >
        {showPin || showArchive ? (
          <span data-task-row-actions="true" className="flex shrink-0 items-center gap-0.5">
            {showPin ? (
              <TaskRowActionButton
                label={intl.formatMessage({
                  id: session.pinned ? "taskList.unpin" : "taskList.pin",
                })}
                onClick={onPinClick}
                disabledReason={pinDisabledReason}
                showTooltip
                testId={`acp-task-pin-${session.id}`}
              >
                <Pin className="size-3.5" />
              </TaskRowActionButton>
            ) : null}
            {showArchive ? (
              <TaskRowActionButton
                label={label}
                onClick={onClick}
                showTooltip
                variant={confirming ? "destructive" : "ghost"}
                size={confirming ? "sm" : "icon-sm"}
                className={confirming ? "shrink-0 border-destructive/20 px-2" : undefined}
                disabledReason={busy ? intl.formatMessage({ id: "common.loading" }) : undefined}
                testId={`acp-task-archive-${session.id}`}
              >
                {confirming ? (
                  label
                ) : session.workspaceIdentity?.trim() ? (
                  <CloudUpload className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
              </TaskRowActionButton>
            ) : null}
          </span>
        ) : null}
        {showWorktreeIndicator ? (
          <WorktreeConversationIndicator workspacePath={session.workspacePath} />
        ) : null}
      </span>
    </span>
  );
}
