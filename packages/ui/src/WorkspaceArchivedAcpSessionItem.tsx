import { useState } from "react";
import { ArchiveX, Cloud, CloudDownload, Folder, Trash2 } from "lucide-react";
import { acpAgentDefinition } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { toast } from "@/components/ui/toast.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { logger } from "@/logger.js";
import { isWorkspaceReadOnly } from "@/store/tabStore.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";

/** Archived ACP history keeps its Host identity; native task services never receive its id. */
export function WorkspaceArchivedAcpSessionItem({
  session,
  service,
  workspaceLabel,
  active,
  onSelect,
}: {
  session: AcpSidebarSession;
  service: IServiceAccessor["acpService"];
  workspaceLabel: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const readOnly = useOptionalTabStore((state) =>
    isWorkspaceReadOnly(state, session.workspacePath, session.workspaceIdentity),
  );
  const [busy, setBusy] = useState(false);
  const target = {
    id: session.id,
    workspacePath: session.workspacePath,
    ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
  };
  const restoreLabel = intl.formatMessage({ id: "taskList.unarchive" });
  const deleteLabel = intl.formatMessage({ id: "taskList.deletePermanently" });
  const isRemote = Boolean(session.workspaceIdentity?.trim());

  async function restore() {
    if (readOnly || busy || session.deletionState) return;
    setBusy(true);
    try {
      await service.updateRow({ ...target, action: { kind: "archive", archived: false } });
    } catch (error) {
      logger.warn("[acp-sidebar] 恢复归档智能体会话失败", { error });
      toast(intl.formatMessage({ id: "taskList.acpRestoreFailed" }));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (readOnly || busy) return;
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "confirmDialog.archivedTaskDeleteTitle" }),
      description: intl.formatMessage({ id: "taskList.acpDeleteDescription" }),
      confirmLabel: deleteLabel,
      confirmVariant: "destructive",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      if (!(await service.removeArchived(target)))
        toast(intl.formatMessage({ id: "taskList.archiveDeleteSkipped" }));
    } catch (error) {
      logger.warn("[acp-sidebar] 删除归档智能体会话失败", { error });
      toast(intl.formatMessage({ id: "taskList.acpDeleteFailed" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          data-testid={`archived-acp-task-${session.id}`}
          onClick={onSelect}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onSelect();
            }
          }}
          role="button"
          tabIndex={0}
          aria-current={active ? "page" : undefined}
          className={cn(
            "cursor-pointer rounded-lg px-2.5 py-2 transition-[background-color,border-color,box-shadow]",
            active ? "bg-selected" : "hover:bg-surface-hover",
          )}
        >
          <div className="flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate text-ui-base text-foreground"
              title={session.title}
            >
              {session.title}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2 text-ui-base text-foreground-subtle">
            <span
              className="flex min-w-0 flex-1 items-center gap-1.5"
              title={session.workspacePath}
            >
              {isRemote ? (
                <Cloud className="size-3 shrink-0" />
              ) : (
                <Folder className="size-3 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {workspaceLabel} · {acpAgentDefinition(session.agent).name}
              </span>
            </span>
            <ControlHintTooltip title={restoreLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={readOnly || busy || Boolean(session.deletionState)}
                aria-label={restoreLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  void restore();
                }}
              >
                {isRemote ? (
                  <CloudDownload className="size-3.5" />
                ) : (
                  <ArchiveX className="size-3.5" />
                )}
              </Button>
            </ControlHintTooltip>
            <ControlHintTooltip title={deleteLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={readOnly || busy}
                aria-label={deleteLabel}
                className="text-destructive hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  void remove();
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </ControlHintTooltip>
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          disabled={readOnly || busy || Boolean(session.deletionState)}
          onSelect={() => void restore()}
        >
          {restoreLabel}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={readOnly || busy} onSelect={() => void remove()}>
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
