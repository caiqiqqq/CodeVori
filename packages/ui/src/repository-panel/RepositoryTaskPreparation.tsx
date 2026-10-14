import { LoaderCircle } from "lucide-react";
import type { WorkTaskScope } from "@zcode/shared";
import type { useRepositoryTask } from "@/hooks/useRepositoryTask.js";
import { WorkTaskEditor } from "@/work-tasks/WorkTaskEditor.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.js";
import { useRepositoryMessages } from "./RepositoryParts.js";

export function RepositoryTaskPreparation({
  progress,
  onCancel,
}: {
  progress: { phase: "detail" | "images"; completed: number; total: number };
  onCancel(): void;
}) {
  const t = useRepositoryMessages();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-testid="repository-task-preparation"
        className="max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>{t("preparingTask")}</DialogTitle>
        </DialogHeader>
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 items-center gap-3 py-2 text-ui-sm text-foreground-subtle"
        >
          <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin text-warning" />
          <span>
            {progress.phase === "detail"
              ? t("readingTaskItem")
              : t("preparingTaskImages", { completed: progress.completed, total: progress.total })}
          </span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RepositoryTaskDraft({
  scope,
  task,
}: {
  scope: WorkTaskScope;
  task: ReturnType<typeof useRepositoryTask>;
}) {
  const t = useRepositoryMessages();
  if (task.preparation)
    return (
      <RepositoryTaskPreparation progress={task.preparation} onCancel={task.cancelPreparation} />
    );
  return task.draft ? (
    <WorkTaskEditor
      key={task.draft.key}
      scope={scope}
      task={null}
      initialDraft={task.draft.initialDraft}
      busy={task.busy}
      error={task.error ? t(`error.${task.error}`) : null}
      onClose={task.close}
      onSave={task.create}
    />
  ) : null;
}
