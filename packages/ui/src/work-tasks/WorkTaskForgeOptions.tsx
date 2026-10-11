import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { ACP_AGENT_CATALOG, type WorkTask, type WorkTaskForgeOptions } from "@zcode/shared";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Button } from "@/components/ui/button.js";
import { useWorkTaskResultDraft } from "@/hooks/useWorkTaskResultDraft.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function useWorkTaskForgeOptions(task: WorkTask) {
  const t = useWorkTaskMessages();
  const [closeIssue, setCloseIssue] = useState(task.source?.kind === "issue");
  const [sendComment, setSendComment] = useState(true);
  const [comment, setComment] = useState(t("resultDefault"));
  const [edited, setEdited] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const ai = useWorkTaskResultDraft(task);
  return {
    closeIssue,
    setCloseIssue,
    sendComment,
    setSendComment,
    comment,
    setComment: (value: string) => {
      setEdited(true);
      setComment(value);
    },
    confirmReplace,
    setConfirmReplace,
    ai,
    fill: async (mode: "merge" | "accept", replace = false) => {
      if (edited && !replace) {
        setConfirmReplace(true);
        return;
      }
      setConfirmReplace(false);
      const text = await ai.generate(mode);
      if (text !== null) {
        setComment(text);
        setEdited(true);
      }
    },
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
  mode = "merge",
}: {
  task: WorkTask;
  options: ReturnType<typeof useWorkTaskForgeOptions>;
  disabled: boolean;
  mode?: "merge" | "accept";
}) {
  const t = useWorkTaskMessages();
  if (!task.source) return null;
  const source = options.ai.source;
  const sourceLabel =
    source?.kind === "api"
      ? `API · ${source.selection.providerId} / ${source.selection.modelId}`
      : source
        ? `${ACP_AGENT_CATALOG.find((agent) => agent.id === source.agent)?.name ?? source.agent} · ${source.modelName}`
        : null;
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
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-foreground-subtle">{t("resultComment")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="work-task-ai-fill"
              disabled={
                disabled ||
                options.ai.loading ||
                !task.session ||
                !!task.workspaceIdentity ||
                !!task.remoteSessionId
              }
              onClick={() => {
                void options.fill(mode);
              }}
            >
              {options.ai.loading ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {t(options.ai.loading ? "aiFilling" : "aiFill")}
            </Button>
          </div>
          <p className="break-all text-foreground-subtle" data-testid="work-task-ai-source">
            {sourceLabel ? t("aiSource", { source: sourceLabel }) : t("aiSourceHint")}
          </p>
          {options.ai.loading ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              data-testid="work-task-ai-cancel"
              onClick={options.ai.cancel}
            >
              {t("aiCancel")}
            </Button>
          ) : null}
          {options.confirmReplace ? (
            <div
              className="flex flex-wrap items-center gap-2 text-foreground-subtle"
              data-testid="work-task-ai-replace"
            >
              <span>{t("aiReplaceHint")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  void options.fill(mode, true);
                }}
              >
                {t("aiReplace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => options.setConfirmReplace(false)}
              >
                {t("close")}
              </Button>
            </div>
          ) : null}
          <WorkTaskError error={options.ai.error} />
          <Textarea
            data-testid="work-task-forge-comment"
            aria-label={t("resultComment")}
            placeholder={t("resultCommentHint")}
            maxLength={60_000}
            value={options.comment}
            disabled={disabled || options.ai.loading}
            className="max-h-40 min-h-20 field-sizing-fixed text-ui-base"
            onChange={(e) => options.setComment(e.target.value)}
          />
          <p className="text-foreground-subtlest">{t("changeRecordsHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
