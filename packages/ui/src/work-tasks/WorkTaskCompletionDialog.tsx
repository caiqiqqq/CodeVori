import { useRef, useState } from "react";
import { Check, GitMerge } from "lucide-react";
import { isWorkTaskForgePending, type WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { canMergeWorkTask, canReviewWorkTaskCompletion } from "@/lib/workTaskBoard.js";
import { useWorkTaskMergeTarget } from "@/hooks/useWorkTaskMergeTarget.js";
import { useWorkTaskAcceptance } from "@/hooks/useWorkTaskAcceptance.js";
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
import { Button } from "@/components/ui/button.js";
import { WorkTaskBranchSelect } from "./WorkTaskBranchSelect.js";
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
  const eligible = canMergeWorkTask(task, panel.executable);
  const assessment = useWorkTaskAcceptance(task, eligible);
  const canMerge = eligible && assessment !== "unavailable";
  const [choice, setChoice] = useState<"merge" | "accept" | null>(null);
  // 用户已选合并后，迟到的不可用/断连结果只能阻止合并，不能悄悄改成完成并关闭议题。
  const mode = choice ?? (canMerge && assessment !== "empty" ? "merge" : "accept");
  const showChoices = canMerge || choice !== null;
  const merging = !retry && mode === "merge";
  const branches = useWorkTaskMergeTarget(task, canMerge);
  const disabled =
    panel.busy ||
    !canReviewWorkTaskCompletion(task) ||
    (canMerge && !choice && assessment === "loading") ||
    (merging && (!canMerge || !branches.valid));
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !panel.busy) onClose(task.id);
      }}
    >
      <AlertDialogContent
        className="max-h-[85dvh] overflow-y-auto"
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
          <AlertDialogDescription>
            {t(merging ? "confirmMergeCompleteBody" : "confirmCompleteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {assessment === "unavailable" && !showChoices ? (
          <p className="text-ui-sm text-foreground-subtle">{t("acceptance.unavailable")}</p>
        ) : null}
        {showChoices ? (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("completionMethod")}>
              {(["merge", "accept"] as const).map((value) => (
                <Button
                  key={value}
                  variant={mode === value ? "secondary" : "outline"}
                  className="min-w-0 flex-1 basis-44"
                  disabled={panel.busy || (value === "merge" && !canMerge)}
                  aria-pressed={mode === value}
                  data-testid={`work-task-completion-${value}`}
                  onClick={() => setChoice(value)}
                >
                  {value === "merge" ? (
                    <GitMerge className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  {t(value === "merge" ? "mergeAndComplete" : "acceptWithoutMerge")}
                </Button>
              ))}
            </div>
            <p
              className="text-ui-sm text-foreground-subtle"
              data-testid="work-task-acceptance-hint"
            >
              {t(`acceptance.${assessment}`)}
            </p>
            {merging && canMerge ? (
              <>
                <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm text-foreground-subtle">
                  {t("mergeTarget")}
                  <WorkTaskBranchSelect
                    label={t("mergeTarget")}
                    value={branches.target}
                    branches={branches.options}
                    testId="work-task-completion-target"
                    onChange={branches.select}
                    disabled={panel.busy || branches.loading}
                    onOpen={() => {
                      void branches.refresh();
                    }}
                  />
                </label>
                <WorkTaskError error={branches.error} />
                {branches.error ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    disabled={panel.busy}
                    onClick={() => {
                      void branches.refresh();
                    }}
                  >
                    {t("branchRetry")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
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
              const request = merging
                ? panel.merge(task.id, branches.target!, options.value)
                : panel.complete(task.id, retry ? undefined : options.value, resend);
              void request
                .then((ok) => {
                  if (ok) onClose(task.id);
                })
                .finally(() => {
                  submitted.current = false;
                });
            }}
          >
            {merging ? <GitMerge className="size-4" /> : <Check className="size-4" />}
            {t(
              retry
                ? "retryForge"
                : merging
                  ? "mergeAndComplete"
                  : canMerge
                    ? "acceptWithoutMerge"
                    : "complete",
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
