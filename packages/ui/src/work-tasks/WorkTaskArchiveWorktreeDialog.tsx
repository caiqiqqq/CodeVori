import { useRef } from "react";
import type { WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskArchiveWorktreeDialog({
  task,
  panel,
  onClose,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onClose(): void;
}) {
  const t = useWorkTaskMessages();
  const submitted = useRef(false);
  const disabled =
    panel.busy ||
    !panel.executable ||
    task.stopPending ||
    task.status !== "done" ||
    !task.worktree ||
    task.worktreeCleanup?.phase === "running";
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !panel.busy && !submitted.current) onClose();
      }}
    >
      <AlertDialogContent
        data-testid="work-task-archive-worktree-dialog"
        onEscapeKeyDown={(event) => {
          if (panel.busy || submitted.current) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("archiveAndRemoveWorktree")}</AlertDialogTitle>
          <p className="break-all text-ui-base font-medium">{task.title}</p>
          <AlertDialogDescription>{t("archiveAndRemoveWorktreeBody")}</AlertDialogDescription>
          <p className="break-all font-mono text-ui-sm text-foreground-subtle">
            {task.worktree?.path}
          </p>
        </AlertDialogHeader>
        <WorkTaskError error={panel.error ?? task.worktreeCleanup?.error ?? null} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={panel.busy}>{t("close")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              // 仅等待 Host 持久受理；后台结果从任务投影读取，提交期间防止重复命令。
              event.preventDefault();
              if (disabled || submitted.current) return;
              submitted.current = true;
              void panel
                .archiveAndRemoveWorktree(task.id)
                .then((ok) => {
                  if (ok) onClose();
                })
                .finally(() => {
                  submitted.current = false;
                });
            }}
          >
            {t("archiveAndRemoveWorktree")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
