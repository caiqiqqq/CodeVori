import { WorkTaskAgent, WorkTaskStatus } from "@/work-tasks/WorkTaskParts.js";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { BoardItem } from "./agentBoardModel.js";
export const boardStatusColors = {
  todo: "text-foreground-subtle",
  review: "text-warning",
  running: "text-brand",
  waiting: "text-warning",
  idle: "text-foreground-subtle",
  error: "text-destructive",
  completed: "text-success",
};
export function AgentBoardCard({
  item,
  projectLabel,
  busy,
  onOpen,
  onPin,
}: {
  item: BoardItem;
  projectLabel?: string;
  busy: boolean;
  onOpen(): void;
  onPin(): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const colors = boardStatusColors;
  const isConversation = item.workspacePurpose === "conversation";
  const change = item.kind === "native" ? item.task.changeSummary : undefined;
  const summary = change
    ? intl.formatMessage(
        { id: "agentBoard.changeSummary" },
        { count: change.fileCount, added: change.added, removed: change.removed },
      )
    : item.summary;
  return (
    <article
      className="rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-brand/40"
      data-board-card={item.key}
    >
      <button
        className="w-full rounded-xl p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onClick={onOpen}
      >
        <div className="mb-3 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtle">
          <span className="truncate">
            {item.kind === "work-task"
              ? `${t("workTasks")} · ${projectLabel ?? item.workspacePath.split("/").pop()}`
              : isConversation
                ? intl.formatMessage({ id: "agentBoard.conversations" })
                : (projectLabel ?? item.workspacePath.split("/").pop())}
          </span>
          {item.kind === "work-task" ? (
            <WorkTaskStatus task={item.workTask} />
          ) : (
            <span className={`shrink-0 ${colors[item.status]}`}>{t(`status.${item.status}`)}</span>
          )}
        </div>
        <h3 className="line-clamp-2 font-medium leading-relaxed">{item.title || t("untitled")}</h3>
        {summary ? (
          <p className="mt-2 line-clamp-2 text-ui-caption leading-relaxed text-foreground-subtle">
            {summary}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2 text-ui-caption text-foreground-subtlest">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded bg-surface px-1.5 py-0.5">
            {item.kind === "work-task" ? (
              <WorkTaskAgent task={item.workTask} />
            ) : item.kind === "acp" ? (
              <AcpAgentIcon agent={item.session.agent} />
            ) : (
              <TaskAgentIcon task={item.task} />
            )}
            {item.kind !== "work-task" ? <span className="truncate">{item.agent}</span> : null}
          </span>
          <span className="shrink-0">
            {new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(item.updatedAt)}
          </span>
        </div>
        {!item.online ? <p className="mt-2 text-ui-caption text-warning">{t("offline")}</p> : null}
      </button>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 px-3 py-1">
        {!isConversation ? (
          <span
            className="mr-auto truncate text-ui-xs text-foreground-subtlest"
            title={item.workspaceIdentity ?? item.workspacePath}
          >
            {item.workspaceIdentity ?? item.workspacePath.split("/").pop()}
          </span>
        ) : null}
        {item.kind !== "work-task" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy || !item.online || item.archived}
            aria-label={item.pinned ? t("unstar") : t("star")}
            aria-pressed={item.pinned}
            onClick={onPin}
          >
            <Star
              className={`size-3.5 ${item.pinned ? "fill-current text-warning" : "text-foreground-subtlest"}`}
            />
          </Button>
        ) : null}
      </div>
    </article>
  );
}
