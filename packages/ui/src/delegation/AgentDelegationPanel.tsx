import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Users,
  Square,
  RotateCcw,
  Play,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import type { DelegationParent } from "@zcode/shared";
import type { useAgentDelegation } from "@/hooks/useAgentDelegation.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { DelegationEditor } from "./DelegationEditor.js";
import { DelegationAttemptResult } from "./DelegationAttemptResult.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { delegationErrorMessage } from "./delegationMessages.js";

export function AgentDelegationPanel({
  parent,
  controller: panel,
}: {
  parent: DelegationParent;
  controller: ReturnType<typeof useAgentDelegation>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const [expanded, setExpanded] = useState(false);
  const editing = panel.editing;
  // 可委派不代表已有委派任务；空列表不应在普通对话末尾留下标题和分隔线。
  if (!panel.tasks.length && !editing) return null;
  const running = panel.tasks.filter((task) =>
    ["queued", "preparing", "running", "awaiting_input"].includes(task.status),
  );
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
    <>
      {panel.tasks.length ? (
        <section
          className="mx-3 mb-2 min-w-0 border-t border-border py-2 text-ui-sm"
          data-testid="delegation-panel"
          data-main-kind={parent.kind}
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <Users className="size-4" />
              <span>{t("title")}</span>
              {panel.tasks.length ? (
                <span className="text-foreground-subtle">
                  {running.length}/{panel.tasks.length}
                </span>
              ) : null}
            </button>
            {running.length
              ? iconButton(
                  t("cancelAll"),
                  () => {
                    void panel.cancelAll();
                  },
                  <Square className="size-3.5" />,
                )
              : null}
          </div>
          {panel.error ? (
            <p role="alert" className="mt-2 break-words text-destructive">
              {panel.error}
            </p>
          ) : null}
          {expanded ? (
            <div className="mt-2 max-h-96 overflow-y-auto">
              {panel.tasks.map((task) => {
                const attempt = task.attempts.at(-1);
                const done = ["completed", "failed", "interrupted", "canceled"].includes(
                  task.status,
                );
                return (
                  <div
                    key={task.id}
                    data-testid="delegation-task"
                    data-status={task.status}
                    className="min-w-0 border-b border-border py-2 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {task.execution.kind === "acp" ? (
                        <AcpAgentIcon agent={task.execution.agent} />
                      ) : (
                        <Users className="size-4" />
                      )}
                      <span className="min-w-0 flex-1 truncate" title={task.title}>
                        {task.title}
                      </span>
                      <span className="shrink-0 text-ui-xs text-foreground-subtle">
                        {t(task.status)}
                      </span>
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
                            () => {
                              panel.openEditor(task.id);
                            },
                            <MessageSquare className="size-3.5" />,
                          )
                        : null}
                    </div>
                    {attempt?.error ? (
                      <p className="mt-1 break-words text-destructive">
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
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) panel.closeEditor();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("new") : t("followUp")}</DialogTitle>
          </DialogHeader>
          {panel.error ? (
            <p role="alert" className="break-words text-destructive">
              {panel.error}
            </p>
          ) : null}
          {editing ? (
            <DelegationEditor
              key={editing}
              parent={parent}
              previousId={editing === "new" ? undefined : editing}
              busy={panel.busy}
              onClose={panel.closeEditor}
              onCreate={panel.delegate}
              onFollowUp={panel.followUp}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
