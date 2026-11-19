import { useState } from "react";
import { History, Workflow } from "lucide-react";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import type { BoardItem } from "./agentBoardModel.js";
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
import { WorkTaskError, useWorkTaskMessages } from "@/work-tasks/WorkTaskParts.js";

type ConversationBoardItem = Extract<BoardItem, { kind: "native" | "acp" }>;

export function AgentBoardConversationWorkflow({
  item,
  panel,
}: {
  item: ConversationBoardItem;
  panel: WorkTaskPanel;
}) {
  const t = useWorkTaskMessages();
  const [handoff, setHandoff] = useState<{
    revision: number;
    stageId: string;
    targetStageId: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const state = item.conversationWorkflow;
  const workflow = panel.board?.workflow;
  const kind = item.kind === "native" ? "api" : "acp";
  const sessionId = item.kind === "native" ? item.task.taskId : item.session.id;
  const busy = panel.busy;
  const stage = state?.definition.stages.find((candidate) => candidate.id === state.currentStageId);
  const targetStage = state?.definition.stages.find(
    (candidate) => candidate.id === handoff?.targetStageId,
  );

  if (!state) {
    return (
      <section
        className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2"
        data-testid="conversation-workflow"
      >
        <Workflow aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium">
            {workflow?.name ?? t("workflow.noProjectWorkflow")}
          </p>
          <p className="text-ui-xs text-foreground-subtle">
            {workflow ? t("workflow.conversationStatusOnly") : t("workflow.selectForProjectFirst")}
          </p>
        </div>
        {workflow?.initialStageId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !panel.executable || item.archived}
            onClick={() => void panel.attachConversationWorkflow(kind, sessionId)}
            data-testid="conversation-workflow-attach"
          >
            <Workflow className="size-4" />
            {t("workflow.useProjectWorkflow")}
          </Button>
        ) : null}
        <WorkTaskError error={panel.error} />
      </section>
    );
  }

  if (!stage) return null;
  const stages = state.definition.stages.filter((candidate) => candidate.enabled !== false);
  // 在线状态只决定聊天输入能力；业务阶段由 Host 工作流独立持久化。
  const canTransition = panel.executable && !item.archived;
  const openTransition = (id: string) => {
    if (id === stage.id) return;
    setNote("");
    setHandoff({ revision: state.revision, stageId: stage.id, targetStageId: id });
  };
  const transfer = async () => {
    if (!handoff || busy) return;
    const changed = await panel.transitionConversationWorkflow(
      kind,
      sessionId,
      handoff.revision,
      handoff.stageId,
      handoff.targetStageId,
      note.trim() || undefined,
    );
    if (changed) setHandoff(null);
  };
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2"
      data-testid="conversation-workflow"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Workflow aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
        <span className="truncate text-ui-sm font-medium">{state.definition.name}</span>
        <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-ui-xs">
          {stages.map((candidate, index) => (
            <li
              key={candidate.id}
              aria-current={candidate.id === stage.id ? "step" : undefined}
              title={candidate.name}
              className={`truncate ${candidate.id === stage.id ? "font-medium text-foreground" : "text-foreground-subtlest"}`}
            >
              {index ? (
                <span aria-hidden="true" className="mr-1">
                  /
                </span>
              ) : null}
              {candidate.name}
            </li>
          ))}
        </ol>
      </div>
      {(state.owner ?? stage.owner) ? (
        <span className="text-ui-xs text-foreground-subtle">
          {t("workflow.owner")}: {state.owner ?? stage.owner}
        </span>
      ) : null}
      <Select value={stage.id} disabled={busy || !canTransition} onValueChange={openTransition}>
        <SelectTrigger
          className="h-8 w-auto gap-2"
          aria-label={t("workflow.changeStatus")}
          data-testid="conversation-workflow-status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {stages.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.history.length ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("workflow.history")}
          onClick={() => setShowHistory(true)}
        >
          <History className="size-4" />
        </Button>
      ) : null}
      <WorkTaskError error={panel.error} />
      {targetStage ? (
        <Dialog open onOpenChange={(open) => !open && !busy && setHandoff(null)}>
          <DialogContent
            className="max-h-[85vh] overflow-y-auto"
            data-testid="conversation-workflow-transition"
          >
            <DialogHeader>
              <DialogTitle>{t("workflow.changeStatusTo", { name: targetStage.name })}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-ui-sm text-foreground-subtle">
              {t("workflow.conversationStatusOnly")}
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
            {targetStage.handoff === "agent" ? (
              <p className="text-ui-sm text-foreground-subtle">
                {t("workflow.conversationAgentHandoffNote")}
              </p>
            ) : null}
            <WorkTaskError error={panel.error} />
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setHandoff(null)}>
                {t("close")}
              </Button>
              <Button
                disabled={
                  busy ||
                  !canTransition ||
                  state.revision !== handoff?.revision ||
                  state.currentStageId !== handoff?.stageId
                }
                onClick={() => void transfer()}
                data-testid="conversation-workflow-confirm"
              >
                {t("workflow.confirmStatus")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {showHistory ? (
        <Dialog open onOpenChange={setShowHistory}>
          <DialogContent
            aria-describedby={undefined}
            className="max-h-[85vh] max-w-2xl overflow-y-auto"
            data-testid="conversation-workflow-history"
          >
            <DialogHeader>
              <DialogTitle>{t("workflow.history")}</DialogTitle>
            </DialogHeader>
            <ol className="divide-y divide-border">
              {state.history.map((entry, index) => {
                const target = state.definition.stages.find(
                  (candidate) => candidate.id === entry.targetStageId,
                );
                return (
                  <li
                    key={`${entry.transitionedAt}:${index}`}
                    className="space-y-1 py-3 text-ui-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {entry.stageName} → {target?.name ?? entry.targetStageId}
                      </span>
                      {entry.owner ? (
                        <span className="text-foreground-subtle">
                          {t("workflow.owner")}: {entry.owner}
                        </span>
                      ) : null}
                      <time className="ml-auto text-ui-xs text-foreground-subtlest">
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(entry.transitionedAt)}
                      </time>
                    </div>
                    {entry.handoffNote ? (
                      <p className="whitespace-pre-wrap text-foreground-subtle">
                        {entry.handoffNote}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
