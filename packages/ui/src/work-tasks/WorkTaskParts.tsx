import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { ACP_AGENT_CATALOG, WORK_TASK_ACTIVE_STATUSES, type WorkTask } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

export function useWorkTaskMessages() {
  const { intl } = useZCodeIntl();
  return (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `workTasks.${key}` }, values);
}
export function WorkTaskIconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <ControlHintTooltip title={label}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
        {children}
      </Button>
    </ControlHintTooltip>
  );
}
export function WorkTaskStatus({ task }: { task: WorkTask }) {
  const t = useWorkTaskMessages();
  const active = WORK_TASK_ACTIVE_STATUSES.includes(task.status);
  return (
    <span
      data-work-task-status={task.status}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-xs",
        task.status === "failed"
          ? "bg-destructive/10 text-destructive"
          : task.status === "awaiting_input"
            ? "bg-interaction-confirmation-surface text-interaction-confirmation-foreground"
            : task.status === "done"
              ? "bg-success/10 text-success"
              : "bg-tag text-foreground-subtle",
      )}
    >
      {active && task.status !== "awaiting_input" ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin" />
      ) : null}
      {t(`status.${task.status}`)}
    </span>
  );
}
export function WorkTaskAgent({
  task,
  iconOnly = false,
}: {
  task: Pick<WorkTask, "execution" | "workspacePath" | "workspaceIdentity">;
  iconOnly?: boolean;
}) {
  const execution = task.execution;
  const label =
    execution.kind === "acp"
      ? (ACP_AGENT_CATALOG.find((agent) => agent.id === execution.agent)?.name ?? execution.agent)
      : execution.modelSelection.modelId;
  const content = (
    <span
      data-work-task-agent
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground-subtle",
        iconOnly && "shrink-0",
      )}
    >
      {execution.kind === "acp" ? (
        <AcpAgentIcon agent={execution.agent} />
      ) : (
        <TaskAgentIcon
          task={{
            workspacePath: task.workspacePath,
            workspaceIdentity: task.workspaceIdentity,
            model: `${execution.modelSelection.providerId}/${execution.modelSelection.modelId}`,
          }}
        />
      )}
      <span className={iconOnly ? "sr-only" : "truncate"}>{label}</span>
    </span>
  );
  return iconOnly ? <ControlHintTooltip title={label}>{content}</ControlHintTooltip> : content;
}
export function WorkTaskError({ error }: { error: string | null }) {
  const t = useWorkTaskMessages();
  if (!error) return null;
  const code = error.match(/work-task\.[a-z-]+/)?.[0];
  const localized = code ? t(`error.${code}`) : error;
  return (
    <p role="alert" className="whitespace-pre-wrap break-all text-ui-sm text-destructive">
      {localized.startsWith("workTasks.error.") ? error : localized}
    </p>
  );
}
