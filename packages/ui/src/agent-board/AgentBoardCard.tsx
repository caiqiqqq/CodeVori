import { WorkTaskAgent } from "@/work-tasks/WorkTaskParts.js";
import { useDraggable } from "@dnd-kit/core";
import { Archive, ArchiveRestore, Folder, GripVertical, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { BoardLayoutMode } from "@/store/agentBoardStore.js";
import { AgentBoardSessionContextMenu } from "./AgentBoardSessionContextMenu.js";
import {
  boardResultTimestamp,
  boardAgentLabel,
  canStageBoardItem,
  boardStatusIndicator,
  type BoardItem,
} from "./agentBoardModel.js";
export const boardStatusColors = {
  running: "text-brand",
  waiting: "text-interaction-confirmation-foreground",
  error: "text-destructive",
  completed: "text-success",
  staged: "text-foreground-subtle",
};
export function AgentBoardCard({
  item,
  layoutMode,
  projectLabel,
  busy,
  onOpen,
  onOpenSession,
  onArchive,
  onStage,
}: {
  item: BoardItem;
  layoutMode: BoardLayoutMode;
  projectLabel?: string;
  busy: boolean;
  onOpen(): void;
  onOpenSession(item: BoardItem): void;
  onArchive(item: BoardItem): void;
  onStage(item: BoardItem): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const canStage = canStageBoardItem(item);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.key,
    disabled: !canStage || item.staged,
  });
  const colors = boardStatusColors;
  const status = boardStatusIndicator(item);
  const isConversation = item.workspacePurpose === "conversation";
  const projectName = projectLabel ?? item.workspacePath.split("/").pop();
  const change = item.kind === "native" ? item.task.changeSummary : undefined;
  const summary = change
    ? intl.formatMessage(
        { id: "agentBoard.changeSummary" },
        { count: change.fileCount, added: change.added, removed: change.removed },
      )
    : item.summary;
  const isList = layoutMode === "list";
  const isCompact = layoutMode === "compact";
  const card = (
    <article
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className={
        isList
          ? "flex min-w-0 items-center rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-brand/40"
          : isCompact
            ? "max-w-56 rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-brand/40"
            : "rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-brand/40"
      }
      data-board-card={item.key}
    >
      <button
        className={
          isList
            ? "flex h-12 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-lg px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand"
            : isCompact
              ? "w-full rounded-lg p-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand"
              : "w-full rounded-xl p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand"
        }
        onClick={onOpen}
      >
        <div
          className={
            isList
              ? "contents"
              : isCompact
                ? "mb-1.5 flex items-center justify-between gap-1.5 text-ui-caption text-foreground-subtle"
                : "mb-3 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtle"
          }
        >
          <div
            className={
              isList
                ? "order-1 flex max-w-24 min-w-0 shrink-0 items-center gap-2 max-sm:max-w-20"
                : "flex min-w-0 items-center gap-2"
            }
          >
            {/* 项目名原先与辅助信息同为灰字，跨项目浏览时难辨认，提升为主文字标签。 */}
            <Badge
              variant="outline"
              className="h-6 min-w-0 shrink justify-start rounded-md bg-accent px-2 text-ui-base font-semibold text-foreground"
              title={isConversation ? t("conversations") : projectName}
            >
              {!isConversation ? (
                <Folder aria-hidden="true" className="shrink-0 text-icon-blue" />
              ) : null}
              <span className="truncate">{isConversation ? t("conversations") : projectName}</span>
            </Badge>
            {item.kind === "work-task" && !isList ? (
              <span className="shrink-0 text-ui-xs">{t("workTasks")}</span>
            ) : null}
          </div>
          <span
            className={
              isList
                ? "order-3 flex shrink-0 items-center gap-2 text-ui-caption text-foreground-subtle"
                : "flex shrink-0 items-center gap-2"
            }
          >
            {item.unread ? (
              <span data-board-unread className="inline-flex items-center gap-1 text-icon-blue">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-icon-blue" />
                {isList ? <span className="sr-only">{t("unread")}</span> : t("unread")}
              </span>
            ) : null}
            <span className={`inline-flex items-center gap-1 ${colors[status]}`}>
              {/* 看板原先只显示状态文字；依真实执行状态补动画，等待或断连不能伪装为执行中。 */}
              {status === "running" && item.online && !item.archived ? (
                <LoaderCircle
                  aria-hidden="true"
                  data-board-running-indicator
                  strokeWidth={3}
                  className="size-3 shrink-0 animate-spin text-task-running-indicator motion-reduce:animate-none"
                />
              ) : null}
              {/* 列表列头已表达分组状态；只在“进行中”列保留等待文字来区分暂停状态。 */}
              <span className={isList && status !== "waiting" ? "sr-only" : ""}>
                {t(`status.${status}`)}
              </span>
            </span>
          </span>
        </div>
        <h3
          className={
            isList
              ? "order-2 min-w-0 flex-1 truncate font-medium"
              : "line-clamp-2 font-medium leading-relaxed"
          }
          title={item.title || t("untitled")}
        >
          {item.title || t("untitled")}
        </h3>
        {summary && !isList ? (
          <p
            className={
              isCompact
                ? "mt-1 line-clamp-1 text-ui-caption leading-snug text-foreground-subtle"
                : "mt-2 line-clamp-2 text-ui-caption leading-relaxed text-foreground-subtle"
            }
          >
            {summary}
          </p>
        ) : null}
        <div
          className={
            isList
              ? "order-4 flex min-w-0 shrink-0 items-center text-ui-caption text-foreground-subtle"
              : isCompact
                ? "mt-1.5 flex items-center justify-between gap-1.5 text-ui-caption text-foreground-subtlest"
                : "mt-4 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtlest"
          }
        >
          {/* 列表模式原先隐藏整行元信息，导致既有模型/Agent 标识消失；保留标识，将次要时间戳收起。 */}
          <span
            data-board-agent-label
            title={boardAgentLabel(item)}
            className={`inline-flex min-w-0 items-center gap-1.5 rounded bg-surface px-1.5 py-0.5 ${isList ? "max-w-20" : ""}`}
          >
            {item.kind === "work-task" ? (
              <WorkTaskAgent task={item.workTask} label={boardAgentLabel(item)} />
            ) : item.kind === "acp" ? (
              <AcpAgentIcon agent={item.session.agent} />
            ) : (
              <TaskAgentIcon task={item.task} />
            )}
            {item.kind !== "work-task" ? (
              <span className="truncate">{boardAgentLabel(item)}</span>
            ) : null}
          </span>
          <span className={isList ? "hidden" : "shrink-0"}>
            {new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(boardResultTimestamp(item))}
          </span>
        </div>
        {!item.online ? (
          <p
            className={
              isList
                ? "order-5 shrink-0 text-ui-caption text-warning max-sm:hidden"
                : "mt-2 text-ui-caption text-warning"
            }
          >
            {t("offline")}
          </p>
        ) : null}
      </button>
      {canStage || !isConversation ? (
        <div
          className={
            isList
              ? "flex shrink-0 items-center justify-end gap-1 border-l border-border/60 px-1"
              : "flex items-center justify-end gap-2 border-t border-border/60 px-3 py-1"
          }
        >
          {canStage && !item.staged ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="touch-none cursor-grab"
              {...listeners}
              {...attributes}
              aria-label={t("dragToStaged")}
            >
              <GripVertical className="size-3.5" />
            </Button>
          ) : null}
          {!isConversation && !isList ? (
            <span
              className="mr-auto truncate text-ui-xs text-foreground-subtlest"
              title={item.workspaceIdentity ?? item.workspacePath}
            >
              {item.workspaceIdentity ?? item.workspacePath.split("/").pop()}
            </span>
          ) : null}
          {canStage ? (
            <Button
              variant="ghost"
              size={isList ? "icon-sm" : "sm"}
              aria-label={t(item.staged ? "unstage" : "stage")}
              title={t(item.staged ? "unstage" : "stage")}
              onClick={() => onStage(item)}
            >
              {isList ? (
                item.staged ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )
              ) : (
                t(item.staged ? "unstage" : "stage")
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
  if (item.kind === "work-task") return card;
  return (
    <AgentBoardSessionContextMenu
      item={item}
      busy={busy}
      onOpenSession={onOpenSession}
      onArchive={onArchive}
      onStage={onStage}
    >
      {card}
    </AgentBoardSessionContextMenu>
  );
}
