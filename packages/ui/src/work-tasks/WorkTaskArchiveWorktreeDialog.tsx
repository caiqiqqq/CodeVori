import { useRef, useState } from "react";
import { isWorkTaskForgeSyncing, type WorkTask } from "@zcode/shared";
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
  const [error, setError] = useState<string | null>(null);
  const syncing = isWorkTaskForgeSyncing(task);
  const disabled =
    panel.busy ||
    !panel.executable ||
    task.stopPending ||
    task.status !== "done" ||
    !task.worktree ||
    task.worktreeCleanup?.phase === "running" ||
    syncing;
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
        {syncing ? (
          <p role="status" className="text-ui-sm text-foreground-subtle">
            {t("cleanup.waitingForForge")}
          </p>
        ) : null}
        <WorkTaskError error={error ?? task.worktreeCleanup?.error ?? null} />
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
              // 本次确认拥有失败反馈；重试清除旧错误，关窗卸载后不再污染其他入口。
              setError(null);
              void panel
                .archiveAndRemoveWorktree(task.id, setError)
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
