import { Check, ListPlus, MessageSquare } from "lucide-react";
import { isWorkTaskForgePending, type ForgeItem, type WorkTask } from "@zcode/shared";
import { RepositoryTaskStatus, repositoryTaskStatusColor } from "./RepositoryTaskStatus.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import {
  RepositoryItemIcon,
  RepositoryLabels,
  RepositoryTime,
  useRepositoryMessages,
} from "./RepositoryParts.js";

export function RepositoryItemRow({
  item,
  busy,
  created,
  linkedTask,
  onSelect,
  onHandle,
  onHandleAgain,
}: {
  item: ForgeItem;
  busy: boolean;
  created: boolean;
  linkedTask?: WorkTask;
  onSelect: () => void;
  onHandle: () => void;
  onHandleAgain?: () => void;
}) {
  const t = useRepositoryMessages();
  return (
    <li className="grid min-w-0 grid-cols-1 items-center gap-x-2 rounded-lg pl-3 pr-2 transition-colors hover:bg-hover focus-within:bg-hover sm:flex">
      <button
        type="button"
        data-testid="repository-item-row"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md py-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="pt-0.5">
          <RepositoryItemIcon item={item} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="break-words text-ui-base font-medium [overflow-wrap:anywhere]">
            {item.title}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-ui-sm text-foreground-subtle">
            <span>#{item.number}</span>
            <span className="break-all">{item.author.username}</span>
            <RepositoryTime value={item.updatedAt} />
            {item.draft ? <span>{t("draft")}</span> : null}
            <RepositoryLabels labels={item.labels} />
          </span>
        </span>
        {item.commentCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-ui-xs text-foreground-subtle">
            <MessageSquare className="size-3.5" />
            {item.commentCount}
          </span>
        ) : null}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        data-testid="repository-item-handle"
        disabled={busy}
        onClick={onHandle}
        className={cn(
          "mb-2 grid shrink-0 justify-self-end rounded-md px-2 text-ui-sm focus-visible:outline-2 focus-visible:outline-ring sm:mb-0",
          linkedTask
            ? cn(repositoryTaskStatusColor(linkedTask), "disabled:opacity-100")
            : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 pl-5">
          {t("taskCreated")}
        </span>
        <span className="col-start-1 row-start-1 flex items-center justify-center gap-1.5">
          {created ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <ListPlus aria-hidden="true" className="size-3.5" />
          )}
          {linkedTask ? <RepositoryTaskStatus task={linkedTask} /> : t("process")}
        </span>
      </Button>
      {linkedTask?.status === "done" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || isWorkTaskForgePending(linkedTask)}
          onClick={onHandleAgain}
          className="mb-2 justify-self-end text-ui-sm sm:mb-0"
        >
          {t("reprocess")}
        </Button>
      ) : null}
    </li>
  );
}
