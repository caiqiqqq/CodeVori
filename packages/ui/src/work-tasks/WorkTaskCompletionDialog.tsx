import { useRef } from "react";
import { Check } from "lucide-react";
import type { WorkTask } from "@zcode/shared";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { canCompleteWorkTask } from "@/lib/workTaskBoard.js";
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

export function WorkTaskCompletionDialog({
  task,
  panel,
  onClose,
}: {
  task: WorkTask;
  panel: ReturnType<typeof useWorkTasks>;
  onClose(id: string): void;
}) {
  const t = useWorkTaskMessages();
  const submitted = useRef(false);
  const disabled = panel.busy || !canCompleteWorkTask(task);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !panel.busy) onClose(task.id);
      }}
    >
      <AlertDialogContent
        data-testid="work-task-completion-dialog"
        onEscapeKeyDown={(event) => {
          if (panel.busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmComplete")}</AlertDialogTitle>
          <p
            className="break-all text-ui-base font-medium"
            data-testid="work-task-completion-title"
          >
            {task.title}
          </p>
          <AlertDialogDescription>{t("confirmCompleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <WorkTaskError error={panel.error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={panel.busy}>{t("close")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            data-testid="work-task-confirm-complete"
            onClick={(event) => {
              // 阻止默认关闭以保留失败反馈；ref 防止忙碌投影刷新前重复提交。
              event.preventDefault();
              if (disabled || submitted.current) return;
              submitted.current = true;
              void panel
                .complete(task.id)
                .then((ok) => {
                  if (ok) onClose(task.id);
                })
                .finally(() => {
                  submitted.current = false;
                });
            }}
          >
            <Check className="size-4" />
            {t("complete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
