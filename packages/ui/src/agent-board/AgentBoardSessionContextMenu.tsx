import type { ReactNode } from "react";
import { Archive, ArchiveRestore, ArrowUpRight, ListTodo } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { canStageBoardItem, type BoardItem } from "./agentBoardModel.js";

type SessionBoardItem = Exclude<BoardItem, { kind: "work-task" }>;

export function AgentBoardSessionContextMenu({
  item,
  busy,
  onOpenSession,
  onArchive,
  onStage,
  children,
}: {
  item: SessionBoardItem;
  busy: boolean;
  onOpenSession(item: SessionBoardItem): void;
  onArchive(item: SessionBoardItem): void;
  onStage(item: SessionBoardItem): void;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const canArchive =
    !busy &&
    item.online &&
    (item.archived || (item.status !== "running" && item.status !== "waiting"));
  const canStage = canStageBoardItem(item);

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {canStage ? (
          <ContextMenuItem onSelect={() => onStage(item)}>
            <ListTodo className="size-4" />
            {t(item.staged ? "unstage" : "stage")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem disabled={!item.online} onSelect={() => onOpenSession(item)}>
          <ArrowUpRight className="size-4" />
          {t("openSession")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canArchive} onSelect={() => onArchive(item)}>
          {item.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          {t(item.archived ? "restore" : "archive")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
