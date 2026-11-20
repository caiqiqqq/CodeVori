import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowRight, History, Undo2 } from "lucide-react";
import { currentWorkTaskWorkflowStage, isWorkTaskMerging, type WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { workTaskConversationBinding } from "@/lib/workTaskConversation.js";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

const WorkTaskSessionView = lazy(() =>
  import("./WorkTaskSessionView.js").then((module) => ({ default: module.WorkTaskSessionView })),
);

export function WorkTaskWorkflowControls({
  task,
  panel,
  onDialogOpenChange,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onDialogOpenChange?(open: boolean): void;
}) {
  const t = useWorkTaskMessages();
  const [handoff, setHandoff] = useState<{
    runSeq: number;
    stageId: string;
    targetId: string;
    name: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const dialogOpen = !!handoff || showHistory;
  // 工作流弹窗接管焦点时，底层会话不能继续接收快捷键或自动聚焦输入框。
  useEffect(() => {
    onDialogOpenChange?.(dialogOpen);
    return () => onDialogOpenChange?.(false);
  }, [dialogOpen, onDialogOpenChange]);
  const state = task.workflow;
  const stage = currentWorkTaskWorkflowStage(task);
  if (!state || !stage) return null;
  const busy = panel.busy || saving;
  const modern = !!state.definition.initialStageId;
  const steps = state.definition.stages.filter((item) => item.enabled !== false);
  const target = steps.find((item) => item.id === handoff?.targetId);
  const startsAgent =
    target &&
    target.status !== "done" &&
    target.status !== "canceled" &&
    (target.handoff ?? (modern ? "none" : "agent")) === "agent";
  const canTransition =
    (modern
      ? ["todo", "review", "failed", "canceled"].includes(task.status)
      : task.status === "review") &&
    !task.archived &&
    !task.stopPending &&
    task.worktreeCleanup?.phase !== "running" &&
    !isWorkTaskMerging(task) &&
    panel.executable;
  const open = (targetId: string) => {
    const target = state.definition.stages.find((candidate) => candidate.id === targetId);
    if (!target) return;
    setNote("");
    setHandoff({ runSeq: task.runSeq, stageId: stage.id, targetId, name: target.name });
  };
  const transfer = async () => {
    if (!handoff || busy) return;
    setSaving(true);
    try {
      if (
        await panel.transitionWorkflow(
          task.id,
          handoff.runSeq,
          handoff.stageId,
          handoff.targetId,
          note.trim() || undefined,
        )
      )
        setHandoff(null);
    } finally {
      setSaving(false);
    }
  };
  const entry = historyIndex === null ? null : state.history[historyIndex];
  const historicalTask: WorkTask | null = entry?.session
    ? {
        ...task,
        execution: entry.execution,
        session: entry.session,
        worktree: entry.worktree,
        directBranch: entry.directBranch,
        archived: true,
        status: "review",
        merge: undefined,
      }
    : null;
  const historicalBinding = historicalTask
    ? workTaskConversationBinding(historicalTask, false)
    : null;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-ui-sm" data-testid="work-task-workflow">
      <ol
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
        aria-label={state.definition.name}
      >
        {steps.map((item, index) => (
          <li
            key={item.id}
            aria-current={item.id === stage.id ? "step" : undefined}
            className={
              item.id === stage.id ? "font-medium text-foreground" : "text-foreground-subtlest"
            }
          >
            {index ? (
              <span aria-hidden="true" className="mr-2">
                →
              </span>
            ) : null}
            {item.name}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {(state.owner ?? stage.owner) ? (
          <span className="text-foreground-subtle">
            {t("workflow.owner")}: {state.owner ?? stage.owner}
          </span>
        ) : null}
        {modern && canTransition ? (
          <Select value={stage.id} disabled={busy} onValueChange={open}>
            <SelectTrigger
              className="w-auto gap-2"
              aria-label={t("workflow.changeStatus")}
              data-testid="workflow-status-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {steps.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {canTransition && stage.nextStageId ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => open(stage.nextStageId!)}
            data-testid="workflow-advance"
          >
            <ArrowRight className="size-4" />
            {t("workflow.advance")}
          </Button>
        ) : null}
        {canTransition && stage.returnStageId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => open(stage.returnStageId!)}
            data-testid="workflow-return"
          >
            <Undo2 className="size-4" />
            {t("workflow.return")}
          </Button>
        ) : null}
        {state.history.length ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setHistoryIndex(null);
              setShowHistory(true);
            }}
          >
            <History className="size-4" />
            {t("workflow.history")}
          </Button>
        ) : null}
      </div>
      {handoff ? (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value && !busy) setHandoff(null);
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="workflow-handoff">
            <DialogHeader>
              <DialogTitle>{t("workflow.handoffTitle", { name: handoff.name })}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-ui-sm text-foreground-subtle">
              {t(startsAgent ? "workflow.handoffDescription" : "workflow.passiveHandoff")}
            </DialogDescription>
            <label className="flex flex-col gap-1 text-ui-sm">
              {t("workflow.handoffNote")}
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={12_000}
                rows={4}
                disabled={busy}
              />
            </label>
            <WorkTaskError error={panel.error} />
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setHandoff(null)}>
                {t("close")}
              </Button>
              <Button
                disabled={
                  busy ||
                  !canTransition ||
                  handoff.runSeq !== task.runSeq ||
                  handoff.stageId !== stage.id
                }
                onClick={() => void transfer()}
                data-testid="workflow-confirm-handoff"
              >
                {t(startsAgent ? "workflow.confirmHandoff" : "workflow.confirmStatus")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {showHistory ? (
        <Dialog open onOpenChange={setShowHistory}>
          <DialogContent
            aria-describedby={undefined}
            className="flex h-[85vh] max-w-4xl flex-col overflow-hidden"
            data-testid="workflow-history"
          >
            <DialogHeader>
              <DialogTitle>{t("workflow.history")}</DialogTitle>
            </DialogHeader>
            <div className="max-h-48 shrink-0 overflow-y-auto">
              {state.history.map((item, index) => (
                <div
                  key={`${item.runSeq}:${index}`}
                  className="flex flex-wrap items-center gap-2 py-1"
                >
                  <Button
                    variant={historyIndex === index ? "secondary" : "ghost"}
                    size="sm"
                    disabled={!item.session}
                    onClick={() => setHistoryIndex(index)}
                  >
                    {item.stageName} · {t("runCount", { count: item.runSeq })}
                    {item.owner ? ` · ${item.owner}` : ""}
                  </Button>
                  {item.handoffNote ? (
                    <p className="min-w-0 basis-full whitespace-pre-wrap break-all text-ui-xs text-foreground-subtle">
                      {item.handoffNote}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div
              className="min-h-0 min-w-0 flex-1 overflow-hidden"
              data-testid="workflow-history-conversation"
            >
              {historicalTask && historicalBinding ? (
                <Suspense fallback={<p role="status">{t("loading")}</p>}>
                  <WorkTaskSessionView
                    key={`${historicalBinding.kind}:${historicalBinding.sessionId}`}
                    task={historicalTask}
                    binding={historicalBinding}
                    readOnly
                    options={{ focused: false }}
                    onClose={() => setHistoryIndex(null)}
                  />
                </Suspense>
              ) : (
                <p className="p-3 text-foreground-subtle">{t("workflow.historyHint")}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
