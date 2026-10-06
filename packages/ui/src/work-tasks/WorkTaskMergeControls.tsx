import { GitMerge } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { isWorkTaskMerging, type WorkTask } from "@zcode/shared";
import { useWorkTaskBranches } from "@/hooks/useWorkTaskBranches.js";
import type { useWorkTasks } from "@/hooks/useWorkTasks.js";
import { Button } from "@/components/ui/button.js";
import { WorkTaskBranchSelect } from "./WorkTaskBranchSelect.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskMergeControls({
  task,
  panel,
  container,
}: {
  task: WorkTask;
  panel: ReturnType<typeof useWorkTasks>;
  container: HTMLElement | null;
}) {
  const t = useWorkTaskMessages();
  const merging = isWorkTaskMerging(task);
  const selectable = task.status === "review" && !task.archived && !!task.worktree;
  const branches = useWorkTaskBranches(
    { ...task, workspacePath: task.worktree?.projectPath ?? task.workspacePath },
    selectable,
  );
  const [selection, setSelection] = useState<string | null>(null);
  const target =
    selection ?? task.merge?.targetBranch ?? task.sourceBranch ?? branches.currentBranch;
  const options = branches.branches.filter((branch) => branch.name !== task.worktree?.branchName);
  const disabled = panel.busy || task.stopPending || merging || !panel.executable;
  // 草稿所有者留在看板中；审查标签卸载时只撤销 portal，重开不能丢失所选分支。
  if (!container) return null;
  return createPortal(
    <section
      className="flex max-h-[40%] min-h-0 min-w-0 shrink-0 flex-col gap-2 overflow-y-auto border-b border-border px-3 py-2"
      data-testid="work-task-merge-controls"
    >
      {selectable ? (
        <>
          <label className="text-ui-sm text-foreground-subtle" htmlFor="work-task-merge-target">
            {t("mergeTarget")}
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <WorkTaskBranchSelect
                label={t("mergeTarget")}
                size="lg"
                value={target}
                branches={options}
                testId="work-task-merge-target"
                onChange={(value) => setSelection(value ?? null)}
                disabled={disabled || branches.loading}
                onOpen={() => {
                  void branches.refresh();
                }}
              />
            </div>
            <Button
              variant="outline"
              size="lg"
              className="ml-auto gap-2 border-icon-blue/20 bg-accent px-3 font-medium text-foreground hover:border-icon-blue/40 hover:bg-icon-blue/15 focus-visible:border-icon-blue focus-visible:bg-icon-blue/15 active:bg-icon-blue/20 disabled:border-border disabled:bg-surface disabled:text-foreground-subtlest disabled:opacity-100"
              data-testid="work-task-merge"
              disabled={
                disabled ||
                branches.loading ||
                !!branches.error ||
                !options.some((branch) => branch.name === target)
              }
              onClick={() => {
                if (target) void panel.merge(task.id, target);
              }}
            >
              <GitMerge className="size-4 text-icon-blue group-disabled/button:text-foreground-subtlest" />
              {t("commitAndMerge")}
            </Button>
          </div>
          <WorkTaskError error={branches.error} />
          {branches.error ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                void branches.refresh();
              }}
            >
              {t("branchRetry")}
            </Button>
          ) : null}
        </>
      ) : null}
      <WorkTaskError error={panel.error ?? task.merge?.error ?? null} />
      {task.merge ? (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
          <dt className="text-foreground-subtle">{t("mergeTarget")}</dt>
          <dd className="break-all font-mono">{task.merge.targetBranch}</dd>
          <dt className="text-foreground-subtle">{t("mergeProgress")}</dt>
          <dd>{t(`mergePhase.${task.merge.phase}`)}</dd>
          {task.merge.resultCommit ? (
            <>
              <dt className="text-foreground-subtle">{t("mergeCommit")}</dt>
              <dd className="break-all font-mono">{task.merge.resultCommit}</dd>
            </>
          ) : null}
          {task.merge.conflicts?.length ? (
            <>
              <dt className="text-foreground-subtle">{t("mergeConflicts")}</dt>
              <dd className="break-all font-mono">{task.merge.conflicts.join(", ")}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>,
    container,
  );
}
