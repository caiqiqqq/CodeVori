import { useState } from "react";
import type { WorkTask, WorkTaskForgeOptions } from "@zcode/shared";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

export function useWorkTaskForgeOptions(task: WorkTask) {
  const t = useWorkTaskMessages();
  const [closeIssue, setCloseIssue] = useState(task.source?.kind === "issue");
  const [sendComment, setSendComment] = useState(true);
  const [comment, setComment] = useState(t("resultDefault"));
  return {
    closeIssue,
    setCloseIssue,
    sendComment,
    setSendComment,
    comment,
    setComment,
    value: task.source
      ? ({
          closeIssue,
          ...(sendComment && comment.trim() ? { comment: comment.trim() } : {}),
        } satisfies WorkTaskForgeOptions)
      : undefined,
  };
}

export function WorkTaskForgeOptionsFields({
  task,
  options,
  disabled,
}: {
  task: WorkTask;
  options: ReturnType<typeof useWorkTaskForgeOptions>;
  disabled: boolean;
}) {
  const t = useWorkTaskMessages();
  if (!task.source) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3 text-ui-sm" data-testid="work-task-forge-options">
      <p className="break-all text-foreground-subtle">
        {t("linkedItem")}: #{task.source.number} · {task.source.title}
      </p>
      {task.source.kind === "issue" ? (
        <label className="flex items-center gap-2">
          <Checkbox
            data-testid="work-task-forge-close"
            checked={options.closeIssue}
            disabled={disabled}
            onCheckedChange={(v) => options.setCloseIssue(v === true)}
          />
          {t("closeLinkedIssue")}
        </label>
      ) : null}
      <label className="flex items-center gap-2">
        <Checkbox
          data-testid="work-task-forge-send-comment"
          checked={options.sendComment}
          disabled={disabled}
          onCheckedChange={(v) => options.setSendComment(v === true)}
        />
        {t("sendResultComment")}
      </label>
      {options.sendComment ? (
        <Textarea
          data-testid="work-task-forge-comment"
          aria-label={t("resultComment")}
          placeholder={t("resultCommentHint")}
          maxLength={60_000}
          value={options.comment}
          disabled={disabled}
          className="max-h-40 min-h-20 field-sizing-fixed text-ui-base"
          onChange={(e) => options.setComment(e.target.value)}
        />
      ) : null}
    </div>
  );
}
