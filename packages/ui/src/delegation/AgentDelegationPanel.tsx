import { useState } from "react";
import { ChevronDown, ChevronRight, Users, Square } from "lucide-react";
import type { DelegationParent, DelegationTask } from "@zcode/shared";
import type { useAgentDelegation } from "@/hooks/useAgentDelegation.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { DelegationEditor } from "./DelegationEditor.js";
import { DelegationTaskRow } from "./DelegationTaskRow.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";

export function AgentDelegationPanel({
  parent,
  controller: panel,
  tasks = panel.tasks,
}: {
  parent: DelegationParent;
  controller: ReturnType<typeof useAgentDelegation>;
  tasks?: readonly DelegationTask[];
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const [expanded, setExpanded] = useState(false);
  const editing = panel.editing;
  // 可委派不代表已有委派任务；空列表不应在普通对话末尾留下标题和分隔线。
  if (!tasks.length && !editing && !panel.error) return null;
  const running = tasks.filter((task) =>
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
      {tasks.length ? (
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
              {tasks.length ? (
                <span className="text-foreground-subtle">
                  {running.length}/{tasks.length}
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
            <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
              {tasks.map((task) => (
                <DelegationTaskRow key={task.id} task={task} controller={panel} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {!tasks.length && panel.error && !editing ? (
        <p role="alert" className="mx-3 mb-2 break-words text-ui-sm text-destructive">
          {panel.error}
        </p>
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
