import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { isWorkTaskForgePending, type WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { canReviewWorkTaskCompletion } from "@/lib/workTaskBoard.js";
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
import { Checkbox } from "@/components/ui/checkbox.js";
import { WorkTaskForgeOptionsFields, useWorkTaskForgeOptions } from "./WorkTaskForgeOptions.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskCompletionDialog({
  task,
  panel,
  onClose,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onClose(id: string): void;
}) {
  const t = useWorkTaskMessages();
  const submitted = useRef(false);
  const options = useWorkTaskForgeOptions(task);
  const retry = task.status === "done" && isWorkTaskForgePending(task);
  const [resend, setResend] = useState(false);
  const disabled = panel.busy || !canReviewWorkTaskCompletion(task);
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
          <AlertDialogTitle>{t(retry ? "retryForge" : "confirmComplete")}</AlertDialogTitle>
          <p
            className="break-all text-ui-base font-medium"
            data-testid="work-task-completion-title"
          >
            {task.title}
          </p>
          <AlertDialogDescription>{t("confirmCompleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {retry ? (
          <div className="flex flex-col gap-2 text-ui-sm" data-testid="work-task-forge-receipts">
            <p>
              {t("commentReceipt")}: {t(`forgeStep.${task.forgeWriteback!.commentState}`)}
            </p>
            <p>
              {t("closeReceipt")}: {t(`forgeStep.${task.forgeWriteback!.closeState}`)}
            </p>
            {["uncertain", "sending"].includes(task.forgeWriteback!.commentState) ? (
              <label className="flex items-start gap-2">
                <Checkbox
                  data-testid="work-task-forge-resend"
                  checked={resend}
                  disabled={panel.busy}
                  onCheckedChange={(v) => setResend(v === true)}
                />
                {t("resendComment")}
              </label>
            ) : null}
          </div>
        ) : (
          <WorkTaskForgeOptionsFields task={task} options={options} disabled={panel.busy} />
        )}
        <WorkTaskError error={panel.error ?? task.forgeWriteback?.error ?? null} />
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
                .complete(task.id, retry ? undefined : options.value, resend)
                .then((ok) => {
                  if (ok) onClose(task.id);
                })
                .finally(() => {
                  submitted.current = false;
                });
            }}
          >
            <Check className="size-4" />
            {t(retry ? "retryForge" : "complete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
