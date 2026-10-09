import { MessageSquare } from "lucide-react";
import type { ForgeItem } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
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
    <li className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        data-testid="repository-item-row"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
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
        variant="outline"
        size="sm"
        data-testid="repository-item-handle"
        disabled={busy || created}
        onClick={onHandle}
        className="shrink-0"
      >
        {created ? t("taskCreated") : t("process")}
      </Button>
    </li>
  );
}
