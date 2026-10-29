import { CircleCheck, Inbox, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useStore } from "zustand";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import type { BoardDisplayStatus } from "./agentBoardModel.js";
import type { BoardSidebarCounts } from "./agentBoardSidebarCounts.js";

const indicators: { status: BoardDisplayStatus; Icon: LucideIcon; color: string }[] = [
  { status: "running", Icon: Play, color: "text-icon-blue" },
  { status: "completed", Icon: CircleCheck, color: "text-success" },
  { status: "staged", Icon: Inbox, color: "text-foreground-subtle" },
  { status: "error", Icon: TriangleAlert, color: "text-destructive" },
];

export function AgentBoardSidebarRow({
  label,
  icon: Icon,
  counts,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children"> & {
  label: string;
  icon: LucideIcon;
  counts?: BoardSidebarCounts;
}) {
  const { intl } = useZCodeIntl();
  const order = useStore(agentBoardStore, (state) => state.statusOrder);
  const visible = order.flatMap((status) =>
    (counts?.[status] ?? 0) > 0 ? indicators.filter((item) => item.status === status) : [],
  );
  const summary = visible
    .map(
      ({ status }) =>
        `${intl.formatMessage({ id: `agentBoard.status.${status}` })} ${counts![status]}`,
    )
    .join("，");
  return (
    <Button
      variant="ghost"
      {...props}
      aria-label={label}
      aria-description={summary || undefined}
      className="min-w-0 justify-start gap-2 aria-pressed:bg-selected"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {visible.length > 0 ? (
        <span
          aria-hidden="true"
          title={summary}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-xs tabular-nums"
          data-board-sidebar-counts
        >
          {visible.map(({ status, Icon: StatusIcon, color }) => (
            <span
              key={status}
              className={`inline-flex items-center gap-0.5 ${color}`}
              data-board-sidebar-status={status}
            >
              <StatusIcon className="size-3! shrink-0" />
              <span>{counts![status]}</span>
            </span>
          ))}
        </span>
      ) : null}
    </Button>
  );
}
