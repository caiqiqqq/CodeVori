import { useDroppable } from "@dnd-kit/core";
import { Circle, LoaderCircle } from "lucide-react";
import { AgentBoardCard, boardStatusColors } from "./AgentBoardCard.js";
import type { BoardLayoutMode } from "@/store/agentBoardStore.js";
import {
  boardStatusIndicator,
  type BoardItem,
  type BoardProject,
  type BoardDisplayStatus,
} from "./agentBoardModel.js";

type BoardGroup = { key: string; label: string; items: BoardItem[] };
export function AgentBoardGroups({
  columns,
  byStatus,
  layoutMode,
  projects,
  onOpen,
  onStage,
}: {
  columns: BoardGroup[];
  byStatus: boolean;
  layoutMode: BoardLayoutMode;
  projects: BoardProject[];
  onOpen(item: BoardItem): void;
  onStage(item: BoardItem): void;
}) {
  // 项目分区只由当前可见会话构成；待办所属项目不能再占一个空列。
  const groups = byStatus ? columns : columns.filter((column) => column.items.length > 0);
  // 紧凑模式用小卡片网格提高横向密度，状态列本身仍沿用卡片布局宽度。
  const compactGrid =
    "grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] content-start gap-2";
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
        <BoardColumn key={column.key} column={column} byStatus={byStatus}>
          <h2 className="mb-3 flex items-center gap-2 px-1 font-medium">
            {byStatus &&
            column.key === "running" &&
            column.items.some(
              (item) => item.online && !item.archived && boardStatusIndicator(item) === "running",
            ) ? (
              <LoaderCircle
                aria-hidden="true"
                data-board-running-indicator
                strokeWidth={3}
                className="size-3 shrink-0 animate-spin text-task-running-indicator motion-reduce:animate-none"
              />
            ) : (
              <Circle
                aria-hidden="true"
                className={`size-3 ${byStatus ? boardStatusColors[column.key as BoardDisplayStatus] : "text-foreground-subtle"}`}
              />
            )}
            <span className="truncate">{column.label}</span>
            <span
              className={`${byStatus ? "ml-auto" : ""} text-ui-caption text-foreground-subtlest`}
            >
              {column.items.length}
            </span>
          </h2>
          <div
            className={
              layoutMode === "list"
                ? byStatus
                  ? "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-4"
                  : "flex min-w-0 flex-col gap-1.5"
                : layoutMode === "compact"
                  ? byStatus
                    ? `${compactGrid} min-h-0 flex-1 overflow-y-auto pb-4`
                    : compactGrid
                  : byStatus
                    ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4"
                    : "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),24rem))] gap-3"
            }
          >
            {column.items.map((item) => (
              <AgentBoardCard
                key={item.key}
                item={item}
                layoutMode={layoutMode}
                projectLabel={projects.find((project) => project.key === item.projectKey)?.label}
                onOpen={() => onOpen(item)}
                onStage={onStage}
              />
            ))}
          </div>
        </BoardColumn>
      ))}
    </div>
  );
}

function BoardColumn({
  column,
  byStatus,
  children,
}: {
  column: BoardGroup;
  byStatus: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.key}`,
    disabled: !byStatus || column.key !== "staged",
    data: { boardStaging: true },
  });
  return (
    <section
      ref={setNodeRef}
      className={`${
        byStatus
          ? "flex min-h-0 w-72 shrink-0 flex-col md:flex-1 md:basis-60 md:min-w-60"
          : "min-w-0 shrink-0"
      } rounded-lg ${isOver ? "bg-accent ring-2 ring-brand" : ""}`}
      data-board-column={column.key}
    >
      {children}
    </section>
  );
}
