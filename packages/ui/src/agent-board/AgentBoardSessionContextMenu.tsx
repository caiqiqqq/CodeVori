import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, ArrowUpRight, Copy, ListTodo, Mail, Pencil } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { TaskRenameDialog } from "@/TaskRenameDialog.js";
import { canStageBoardItem, type BoardItem } from "./agentBoardModel.js";

type SessionBoardItem = Exclude<BoardItem, { kind: "work-task" }>;

export function AgentBoardSessionContextMenu({
  item,
  busy,
  onOpenSession,
  onArchive,
  onStage,
  onRename,
  onMarkUnread,
  allowMarkUnread = true,
  children,
}: {
  item: SessionBoardItem;
  busy: boolean;
  onOpenSession(item: SessionBoardItem): void;
  onArchive(item: SessionBoardItem): void;
  onStage(item: SessionBoardItem): void;
  onRename(item: SessionBoardItem, title: string): Promise<void>;
  onMarkUnread(item: SessionBoardItem): void;
  allowMarkUnread?: boolean;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);
  const canArchive =
    !busy &&
    item.online &&
    (item.archived || (item.status !== "running" && item.status !== "waiting"));
  const canStage = canStageBoardItem(item);
  const canMarkUnread =
    !busy &&
    item.online &&
    !item.archived &&
    !item.unread &&
    (item.status === "completed" || item.status === "error");
  const sessionId = item.kind === "native" ? item.task.taskId : item.session.id;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      logger.warn("[agent-board] 复制会话信息失败", { error });
      toast(t("actionFailed"));
    }
  };
  const confirmRename = () => {
    const title = renameDraft.trim();
    if (!title || renamePending || busy) return;
    if (title.length > 200) {
      toast(intl.formatMessage({ id: "taskList.renameFailed" }));
      return;
    }
    if (title === item.title) {
      setRenaming(false);
      return;
    }
    setRenamePending(true);
    void onRename(item, title)
      .then(() => setRenaming(false))
      .catch((error: unknown) => {
        logger.warn("[agent-board] 重命名会话失败", { error });
        toast(intl.formatMessage({ id: "taskList.renameFailed" }));
      })
      .finally(() => setRenamePending(false));
  };

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {canStage ? (
            <ContextMenuItem onSelect={() => onStage(item)}>
              <ListTodo className="size-4" />
              {t(item.staged ? "unstage" : "stage")}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem disabled={busy || !item.online} onSelect={() => onOpenSession(item)}>
            <ArrowUpRight className="size-4" />
            {t("openSession")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={busy || !item.online}
            onSelect={() => {
              setRenameDraft(item.title);
              setRenaming(true);
            }}
          >
            <Pencil className="size-4" />
            {intl.formatMessage({ id: "taskList.rename" })}
          </ContextMenuItem>
          {allowMarkUnread ? (
            <ContextMenuItem disabled={!canMarkUnread} onSelect={() => onMarkUnread(item)}>
              <Mail className="size-4" />
              {intl.formatMessage({ id: "taskList.markAsUnread" })}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem disabled={!canArchive} onSelect={() => onArchive(item)}>
            {item.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {t(item.archived ? "restore" : "archive")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void copy(item.workspacePath)}>
            <Copy className="size-4" />
            {intl.formatMessage({ id: "appHeader.copyPath" })}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copy(sessionId)}>
            <Copy className="size-4" />
            {intl.formatMessage({ id: "appHeader.copySessionId" })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {renaming ? (
        <TaskRenameDialog
          open
          value={renameDraft}
          inputRef={renameInputRef}
          intl={intl}
          onOpenChange={(open) => {
            if (!open && !renamePending) setRenaming(false);
          }}
          onChange={setRenameDraft}
          onCancel={() => setRenaming(false)}
          onConfirm={confirmRename}
        />
      ) : null}
    </>
  );
}
