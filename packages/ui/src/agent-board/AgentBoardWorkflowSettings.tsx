import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { DEFAULT_BOARD_WORKFLOW_STATUSES, type BoardWorkflowStatus } from "./agentBoardModel.js";

export function AgentBoardWorkflowSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.workflow.${id}` });
  const statusLabel = (status: BoardWorkflowStatus) => {
    const initial = DEFAULT_BOARD_WORKFLOW_STATUSES.find((entry) => entry.id === status.id);
    return initial?.label === status.label ? t(`status.${status.id}`) : status.label;
  };
  const [statuses, setStatuses] = useState<BoardWorkflowStatus[]>([]);
  const [newLabel, setNewLabel] = useState("");
  useEffect(() => {
    if (open)
      setStatuses(
        agentBoardStore.getState().workflowStatuses.map((status) => ({
          ...status,
          label: statusLabel(status),
        })),
      );
  }, [open]);
  const move = (index: number, offset: number) => {
    const next = [...statuses];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setStatuses(next);
  };
  const add = () => {
    const label = newLabel.trim();
    if (!label || statuses.length >= 32) return;
    setStatuses([
      ...statuses,
      { id: `custom-${crypto.randomUUID().slice(0, 24)}`, label, enabled: true },
    ]);
    setNewLabel("");
  };
  const enabledCount = statuses.filter((status) => status.enabled).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
        <ol className="max-h-[min(60vh,32rem)] space-y-2 overflow-y-auto" aria-label={t("title")}>
          {statuses.map((status, index) => (
            <li
              key={status.id}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2"
            >
              <input
                aria-label={statusLabel(status)}
                className="h-8 min-w-0 flex-1 rounded-md border border-input-border bg-input px-2 text-ui-base"
                maxLength={40}
                value={statusLabel(status)}
                onChange={(event) =>
                  setStatuses(
                    statuses.map((entry) =>
                      entry.id === status.id ? { ...entry, label: event.target.value } : entry,
                    ),
                  )
                }
              />
              <label className="flex shrink-0 items-center gap-2 text-ui-caption text-foreground-subtle">
                <input
                  type="checkbox"
                  checked={status.enabled}
                  disabled={status.enabled && enabledCount === 1}
                  onChange={(event) =>
                    setStatuses(
                      statuses.map((entry) =>
                        entry.id === status.id
                          ? { ...entry, enabled: event.target.checked }
                          : entry,
                      ),
                    )
                  }
                />
                {t("enabled")}
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("moveUp")}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("moveDown")}
                disabled={index === statuses.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("remove")}
                disabled={statuses.length === 1 || (status.enabled && enabledCount === 1)}
                onClick={() => setStatuses(statuses.filter((entry) => entry.id !== status.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            aria-label={t("newStatus")}
            className="h-9 min-w-0 flex-1 rounded-lg border border-input-border bg-input px-3 text-ui-base"
            maxLength={40}
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder={t("newStatus")}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!newLabel.trim() || statuses.length >= 32}
          >
            <Plus className="size-4" />
            {t("add")}
          </Button>
        </form>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={statuses.some((status) => !status.label.trim())}
            onClick={() => {
              agentBoardStore.getState().setWorkflowStatuses(statuses);
              onOpenChange(false);
            }}
          >
            {t("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
