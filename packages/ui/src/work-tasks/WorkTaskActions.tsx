import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Info,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { isWorkTaskForgeSyncing, WORK_TASK_ACTIVE_STATUSES, type WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { canReviewWorkTaskCompletion } from "@/lib/workTaskBoard.js";
import { WorkTaskIconButton, useWorkTaskMessages } from "./WorkTaskParts.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskArchiveWorktreeDialog } from "./WorkTaskArchiveWorktreeDialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";

export function WorkTaskActions({
  task,
  panel,
  onOpenConversation,
  onEdit,
  onComplete,
  onDetails,
  showConversation = true,
  menu = false,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onOpenConversation(task: WorkTask): void;
  onEdit(task: WorkTask): void;
  onComplete(task: WorkTask): void;
  onDetails?(task: WorkTask): void;
  showConversation?: boolean;
  menu?: boolean;
}) {
  const t = useWorkTaskMessages();
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const active = WORK_TASK_ACTIVE_STATUSES.includes(task.status) || task.status === "queued";
  const startable = ["todo", "failed", "canceled"].includes(task.status) && !task.archived;
  const disabled = panel.busy || task.stopPending || task.worktreeCleanup?.phase === "running";
  const syncing = isWorkTaskForgeSyncing(task);
  const actions: {
    label: string;
    hint?: string;
    Icon: LucideIcon;
    disabled?: boolean;
    run(): void;
  }[] = [];
  if (canReviewWorkTaskCompletion(task))
    actions.push({
      label: t(task.status === "done" ? "retryForge" : "complete"),
      Icon: Check,
      disabled,
      run: () => onComplete(task),
    });
  if (onDetails) actions.push({ label: t("details"), Icon: Info, run: () => onDetails(task) });
  if (showConversation && task.session)
    actions.push({
      label: t("openConversation"),
      Icon: MessageSquare,
      run: () => onOpenConversation(task),
    });
  if (startable)
    actions.push({
      label: t(task.status === "todo" ? "start" : "retry"),
      Icon: Play,
      disabled: disabled || !panel.executable,
      run: () => {
        void panel.start(task.id);
      },
    });
  if (["todo", "failed"].includes(task.status))
    actions.push({ label: t("edit"), Icon: Pencil, disabled, run: () => onEdit(task) });
  actions.push(
    active
      ? {
          label: t("cancel"),
          Icon: Square,
          disabled: disabled || task.merge?.phase === "applying",
          run: () => {
            void panel.cancel(task.id);
          },
        }
      : {
          label: t(task.archived ? "unarchive" : "archive"),
          Icon: task.archived ? ArchiveRestore : Archive,
          disabled,
          run: () => {
            void panel.archive(task.id, !task.archived);
          },
        },
  );
  if (
    menu &&
    task.status === "done" &&
    !task.archived &&
    task.worktree &&
    task.useWorktree !== false
  )
    actions.push({
      label: t(
        task.worktreeCleanup?.phase === "failed" ? "retryCleanup" : "archiveAndRemoveWorktree",
      ),
      Icon: Trash2,
      // 已完成但仍同步议题时，菜单和 Host 使用同一租约判断，避免可点却误报未完成。
      hint: syncing ? t("cleanup.waitingForForge") : undefined,
      disabled: disabled || !panel.executable || syncing,
      run: () => setConfirmCleanup(true),
    });
  return (
    <>
      {menu ? (
        // 菜单内会打开独立弹窗，双重模态锁可能在关闭后残留 body pointer-events:none。
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("taskActions")}
              title={t("taskActions")}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map(({ label, hint, Icon, disabled, run }) => (
              <DropdownMenuItem key={label} disabled={disabled} onSelect={run}>
                <Icon className="size-4" />
                {hint ? (
                  <span className="min-w-0">
                    {label}
                    <span className="block max-w-64 whitespace-normal text-ui-xs">{hint}</span>
                  </span>
                ) : (
                  label
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5">
          {actions.map(({ label, Icon, disabled, run }) => (
            <WorkTaskIconButton key={label} label={label} disabled={disabled} onClick={run}>
              <Icon className="size-4" />
            </WorkTaskIconButton>
          ))}
        </div>
      )}
      {confirmCleanup ? (
        <WorkTaskArchiveWorktreeDialog
          task={task}
          panel={panel}
          onClose={() => setConfirmCleanup(false)}
        />
      ) : null}
    </>
  );
}
