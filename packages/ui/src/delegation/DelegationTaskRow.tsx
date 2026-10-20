import { ArrowUpRight, MessageSquare, Play, RotateCcw, Square } from "lucide-react";
import type { DelegationTask } from "@zcode/shared";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
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
      <ToolLayout
        toolId={`delegation:${task.id}`}
        icon={
          task.execution.kind === "acp" ? (
            <AcpAgentIcon agent={task.execution.agent} />
          ) : (
            <TaskAgentIcon
              task={{
                workspacePath: task.parent.workspacePath,
                workspaceIdentity: task.parent.workspaceIdentity,
              }}
              providerId={task.execution.modelSelection.providerId}
            />
          )
        }
        kindLabel={t("title")}
        primaryText={
          <span className="truncate" title={task.title}>
            {task.title}
          </span>
        }
        statusLabel={t(task.status)}
        showStatusLabel
        isRunning={!done}
        title={task.title}
        renderContent={() => (
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
        )}
      />
    </div>
  );
}
