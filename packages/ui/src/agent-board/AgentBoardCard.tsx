import { WorkTaskAgent } from "@/work-tasks/WorkTaskParts.js";
import { Folder, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  boardResultTimestamp,
  boardAgentLabel,
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
  projectLabel,
  onOpen,
}: {
  item: BoardItem;
  projectLabel?: string;
  onOpen(): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
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
  return (
    <article
      className="rounded-lg border border-card-border bg-card transition-colors hover:border-border-hover hover:bg-hover"
      data-board-card={item.key}
    >
      <button
        className="w-full rounded-lg p-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
        onClick={onOpen}
      >
        <div className="mb-3 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtle">
          <div className="flex min-w-0 items-center gap-2">
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
            {item.kind === "work-task" ? (
              <span className="shrink-0 text-ui-xs">{t("workTasks")}</span>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center gap-2">
            {item.unread ? (
              <span data-board-unread className="inline-flex items-center gap-1 text-icon-blue">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-icon-blue" />
                {t("unread")}
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
              {t(`status.${status}`)}
            </span>
          </span>
        </div>
        <h3 className="line-clamp-2 text-ui-base font-semibold leading-snug">
          {item.title || t("untitled")}
        </h3>
        {summary ? (
          <p className="mt-2 line-clamp-2 text-ui-caption leading-relaxed text-foreground-subtle">
            {summary}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtlest">
          <span
            data-board-agent-label
            className="inline-flex min-w-0 items-center gap-1.5 rounded bg-surface px-1.5 py-0.5"
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
          <span className="shrink-0">
            {new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(boardResultTimestamp(item))}
          </span>
        </div>
        {!item.online ? <p className="mt-2 text-ui-caption text-warning">{t("offline")}</p> : null}
      </button>
    </article>
  );
}
