import { ListTodoIcon } from "lucide-react";
import { memo } from "react";
import type { PlanRow } from "@zcode/shared/zcode-protocol-v4";
import { PlanSteps } from "@/ToolCallBlocks/PlanSteps.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const icon = <ListTodoIcon className="size-4 shrink-0 text-foreground-subtle" />;

export const ConversationPlanRowView = memo(function ConversationPlanRowView({
  row,
}: {
  row: PlanRow;
}) {
  const { intl } = useZCodeIntl();
  if (!row.entries.length) return null;
  const completed = row.entries.filter((step) => step.status === "completed").length;
  const active =
    row.entries.find((step) => step.status === "in_progress") ??
    row.entries.find((step) => step.status === "pending") ??
    row.entries.at(-1);
  return (
    <div data-conversation-plan={row.planId}>
      <ToolLayout
        toolId={row.planId}
        icon={icon}
        kindLabel={intl.formatMessage({ id: "todo.panel.title" })}
        primaryText={
          <span className="min-w-0 truncate text-foreground-subtlest">{active?.content}</span>
        }
        secondaryText={
          <span className="shrink-0 font-mono text-ui-base text-foreground-subtlest">
            {completed}/{row.entries.length}
          </span>
        }
        content={
          <div
            className="space-y-1 rounded-xl bg-surface px-3 py-2"
            data-conversation-selectable="true"
          >
            <PlanSteps
              steps={row.entries.map((step, index) => ({
                id: String(index),
                title: step.content,
                status: step.status,
              }))}
            />
          </div>
        }
      />
    </div>
  );
});
