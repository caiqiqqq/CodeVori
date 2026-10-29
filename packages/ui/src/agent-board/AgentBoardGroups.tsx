import { Circle } from "lucide-react";
import { AgentBoardCard, boardStatusColors } from "./AgentBoardCard.js";
import type { BoardItem, BoardProject, BoardDisplayStatus } from "./agentBoardModel.js";

type BoardGroup = { key: string; label: string; items: BoardItem[] };
export function AgentBoardGroups({
  columns,
  byStatus,
  projects,
  busy,
  onOpen,
  onPin,
}: {
  columns: BoardGroup[];
  byStatus: boolean;
  projects: BoardProject[];
  busy: boolean;
  onOpen(item: BoardItem): void;
  onPin(item: BoardItem): void;
}) {
  // 项目分区只由当前可见会话构成；待办所属项目不能再占一个空列。
  const groups = byStatus ? columns : columns.filter((column) => column.items.length > 0);
  return (
    <div
      className={
        byStatus
          ? "flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 py-5 md:px-6"
          : "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 md:px-6"
      }
      data-testid="agent-board-columns"
    >
      {groups.map((column) => (
        <section
          key={column.key}
          className={
            byStatus
              ? "flex min-h-0 w-72 shrink-0 flex-col md:flex-1 md:basis-60 md:min-w-60"
              : "min-w-0 shrink-0"
          }
          data-board-column={column.key}
        >
          <h2 className="mb-3 flex items-center gap-2 px-1 font-medium">
            <Circle
              className={`size-3 ${byStatus ? boardStatusColors[column.key as BoardDisplayStatus] : "text-foreground-subtle"}`}
            />
            <span className="truncate">{column.label}</span>
            <span
              className={`${byStatus ? "ml-auto" : ""} text-ui-caption text-foreground-subtlest`}
            >
              {column.items.length}
            </span>
          </h2>
          <div
            className={
              byStatus
                ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4"
                : "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),24rem))] gap-3"
            }
          >
            {column.items.map((item) => (
              <AgentBoardCard
                key={item.key}
                item={item}
                projectLabel={projects.find((project) => project.key === item.projectKey)?.label}
                busy={busy}
                onOpen={() => onOpen(item)}
                onPin={() => onPin(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
