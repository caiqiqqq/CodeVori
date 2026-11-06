import { useId, useState } from "react";
import { ArrowUpRight, ChevronRight, MessageSquare, Play, RotateCcw, Square } from "lucide-react";
import type { DelegationTask } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AgentToolLayout } from "@/ToolCallBlocks/AgentToolLayout.js";
import type { useAgentDelegation } from "@/hooks/useAgentDelegation.js";
import { DelegationAttemptResult } from "./DelegationAttemptResult.js";
import { delegationErrorMessage } from "./delegationMessages.js";

export function DelegationTaskRow({
  task,
  controller: panel,
}: {
  task: DelegationTask;
  controller: ReturnType<typeof useAgentDelegation>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const done = ["completed", "failed", "interrupted", "canceled"].includes(task.status);
  const attempt = task.attempts.at(-1);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const detailsLabel = intl.formatMessage({
    id: expanded ? "chat.toolCall.collapseDetails" : "chat.toolCall.expandDetails",
  });
  const agentName =
    task.execution.kind === "acp" ? task.execution.agent : task.execution.modelSelection.modelId;
  const iconButton = (label: string, action: () => void, icon: React.ReactNode) => (
    <ControlHintTooltip title={label}>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={panel.busy}
        aria-label={label}
        onClick={action}
      >
        {icon}
      </Button>
    </ControlHintTooltip>
  );
  return (
    <div data-testid="delegation-task" data-status={task.status} className="min-w-0 text-ui-base">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <AgentToolLayout
              toolId={`delegation:${task.id}`}
              agentName={agentName}
              primaryText={<span className="truncate">{task.title}</span>}
              statusLabel={t(task.status)}
              statusTooltip={
                attempt?.error ? delegationErrorMessage(attempt.error, intl) : undefined
              }
              showStatusLabel
              showFailureStatus={task.status === "failed"}
              isRunning={!done}
              title={task.title}
              summaryAction={
                task.session
                  ? {
                      ariaLabel: t("open"),
                      onActivate: () => {
                        void panel.open(task);
                      },
                    }
                  : undefined
              }
            />
          </div>
          <ControlHintTooltip title={detailsLabel}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-foreground-subtlest"
                aria-label={detailsLabel}
                aria-controls={detailsId}
              >
                <ChevronRight
                  className={cn("size-4 transition-transform", expanded && "rotate-90")}
                />
              </Button>
            </CollapsibleTrigger>
          </ControlHintTooltip>
        </div>
        <CollapsibleContent id={detailsId}>
          <div className="pt-2">
            <div className="ml-2 min-w-0 space-y-2 border-l border-border pl-3.5 text-ui-sm">
              <div className="flex flex-wrap items-center gap-1">
                {task.session
                  ? iconButton(
                      t("open"),
                      () => {
                        void panel.open(task);
                      },
                      <ArrowUpRight className="size-3.5" />,
                    )
                  : null}
                {!done
                  ? iconButton(
                      t("cancel"),
                      () => {
                        void panel.cancel(task.id);
                      },
                      <Square className="size-3.5" />,
                    )
                  : null}
                {task.status === "failed"
                  ? iconButton(
                      t("retry"),
                      () => {
                        void panel.retry(task.id);
                      },
                      <RotateCcw className="size-3.5" />,
                    )
                  : null}
                {task.status === "interrupted"
                  ? iconButton(
                      t("resume"),
                      () => {
                        void panel.resume(task.id);
                      },
                      <Play className="size-3.5" />,
                    )
                  : null}
                {done && task.session
                  ? iconButton(
                      t("followUp"),
                      () => panel.openEditor(task.id),
                      <MessageSquare className="size-3.5" />,
                    )
                  : null}
              </div>
              {attempt?.error ? (
                <p className="break-words text-destructive">
                  {delegationErrorMessage(attempt.error, intl)}
                </p>
              ) : null}
              {task.attempts
                .filter((item) => item.endedAt)
                .map((item) => (
                  <DelegationAttemptResult
                    key={item.sequence}
                    attempt={item}
                    busy={panel.busy}
                    redeliver={() => {
                      void panel.redeliver(task.id, item.sequence);
                    }}
                  />
                ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
