import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  Pencil,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { WORK_TASK_ACTIVE_STATUSES, type WorkTask } from "@zcode/shared";
import { useWorkTaskEvents } from "@/hooks/useWorkTaskEvents.js";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import {
  WorkTaskAgent,
  WorkTaskError,
  WorkTaskStatus,
  useWorkTaskMessages,
} from "./WorkTaskParts.js";
import { WorkTaskAttachments } from "./WorkTaskAttachments.js";

export function WorkTaskDetail({
  task,
  panel,
  onClose,
  onEdit,
  onOpenConversation,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onClose(): void;
  onEdit(): void;
  onOpenConversation(task: WorkTask): void;
}) {
  const t = useWorkTaskMessages();
  const events = useWorkTaskEvents(task);
  const [feedback, setFeedback] = useState("");
  const active = WORK_TASK_ACTIVE_STATUSES.includes(task.status) || task.status === "queued";
  const disabled = panel.busy || task.stopPending;
  const startable = ["todo", "failed", "canceled"].includes(task.status) && !task.archived;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !panel.busy) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
        data-testid="work-task-detail"
      >
        <DialogHeader>
          <DialogTitle className="pr-8 break-all">{task.title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <WorkTaskStatus task={task} />
          <WorkTaskAgent task={task} />
          <span className="text-ui-xs text-foreground-subtlest">
            {t("runCount", { count: task.runSeq })}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-all text-ui-base">{task.prompt}</p>
        <WorkTaskAttachments scope={task} saved={task.attachments} />
        <WorkTaskError error={task.failureReason ?? null} />
        {task.worktree ? (
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-3 text-ui-sm">
            {task.sourceBranch ? (
              <>
                <dt className="text-foreground-subtle">{t("sourceBranch")}</dt>
                <dd className="break-all font-mono">{task.sourceBranch}</dd>
              </>
            ) : null}
            <dt className="text-foreground-subtle">{t("branch")}</dt>
            <dd className="break-all font-mono">{task.worktree.branchName}</dd>
            <dt className="text-foreground-subtle">{t("worktree")}</dt>
            <dd className="break-all font-mono">{task.worktree.path}</dd>
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {task.session ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenConversation(task)}
              data-testid="work-task-open-conversation"
            >
              <MessageSquare className="size-4" />
              {t(task.status === "awaiting_input" ? "handleInput" : "openConversation")}
            </Button>
          ) : null}
          {startable ? (
            <Button
              size="sm"
              disabled={disabled || !panel.executable}
              onClick={() => {
                void panel.start(task.id);
              }}
            >
              <Play className="size-4" />
              {t(task.status === "todo" ? "start" : "retry")}
            </Button>
          ) : null}
          {["todo", "failed"].includes(task.status) ? (
            <Button variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
              <Pencil className="size-4" />
              {t("edit")}
            </Button>
          ) : null}
          {active ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || task.merge?.phase === "applying"}
              onClick={() => {
                void panel.cancel(task.id);
              }}
            >
              <Square className="size-4" />
              {t("cancel")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                void panel.archive(task.id, !task.archived).then((ok) => {
                  if (ok) onClose();
                });
              }}
            >
              {task.archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {t(task.archived ? "unarchive" : "archive")}
            </Button>
          )}
        </div>
        {task.status === "review" && !task.archived ? (
          <form
            className="flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void panel.start(task.id, feedback.trim()).then((ok) => {
                if (ok) setFeedback("");
              });
            }}
          >
            <label className="text-ui-sm text-foreground-subtle" htmlFor="work-task-feedback">
              {t("feedback")}
            </label>
            <Textarea
              id="work-task-feedback"
              data-testid="work-task-feedback"
              className="h-24 field-sizing-fixed border-input-border bg-input text-foreground"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={disabled}
            />
            <Button
              className="self-end"
              size="sm"
              type="submit"
              disabled={disabled || !feedback.trim() || !panel.executable}
              data-testid="work-task-follow-up"
            >
              <RotateCcw className="size-4" />
              {t("followUp")}
            </Button>
          </form>
        ) : null}
        <WorkTaskError error={panel.error} />
        {events.length ? (
          <section className="border-t border-border pt-3">
            <h3 className="mb-2 text-ui-sm font-medium text-foreground-subtle">{t("events")}</h3>
            <ol className="flex max-h-40 flex-col gap-1 overflow-y-auto text-ui-sm text-foreground-subtle">
              {events
                .filter((event) => event.type !== "execution-updated")
                .map((event) => (
                  <li key={event.sequence} className="flex min-w-0 gap-2">
                    <span className="shrink-0 font-mono text-foreground-subtlest">
                      {event.sequence}
                    </span>
                    <span className="break-all">{t(`event.${event.type}`)}</span>
                  </li>
                ))}
            </ol>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
