import { Check, ListPlus, MessageSquare } from "lucide-react";
import type { ForgeItem } from "@zcode/shared";
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
  onSelect,
  onHandle,
}: {
  item: ForgeItem;
  busy: boolean;
  created: boolean;
  onSelect: () => void;
  onHandle: () => void;
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
        disabled={busy || created}
        onClick={onHandle}
        className={cn(
          "mb-2 grid shrink-0 justify-self-end rounded-md px-2 text-ui-sm focus-visible:outline-2 focus-visible:outline-ring sm:mb-0",
          created
            ? "text-success disabled:opacity-100"
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
          {created ? t("taskCreated") : t("process")}
        </span>
      </Button>
    </li>
  );
}
