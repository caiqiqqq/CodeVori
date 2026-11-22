import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import {
  BOARD_WORKFLOW_STATUS_CATEGORIES,
  DEFAULT_BOARD_WORKFLOW_STATUSES,
  type BoardWorkflowStatus,
  type BoardWorkflowStatusCategory,
} from "./agentBoardModel.js";

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
  const [newCategory, setNewCategory] = useState<BoardWorkflowStatusCategory>("started");
  useEffect(() => {
    if (open)
      setStatuses(
        agentBoardStore.getState().workflowStatuses.map((status) => ({
          ...status,
          label: statusLabel(status),
        })),
      );
  }, [open]);
  const move = (status: BoardWorkflowStatus, offset: number) => {
    const next = [...statuses];
    const indexes = next.flatMap((entry, index) =>
      entry.category === status.category ? [index] : [],
    );
    const current = indexes.indexOf(next.findIndex((entry) => entry.id === status.id));
    const target = indexes[current + offset];
    if (target === undefined) return;
    const source = indexes[current]!;
    [next[source], next[target]] = [next[target]!, next[source]!];
    setStatuses(next);
  };
  const add = () => {
    const label = newLabel.trim();
    if (!label || statuses.length >= 32) return;
    setStatuses([
      ...statuses,
      {
        id: `custom-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
        label,
        enabled: true,
        category: newCategory,
      },
    ]);
    setNewLabel("");
  };
  const enabledCount = statuses.filter((status) => status.enabled).length;
  const categoryLabel = (category: BoardWorkflowStatusCategory) => t(`category.${category}`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
        <p className="text-ui-caption text-foreground-subtle">{t("assigneeOnEntry")}</p>
        <div className="max-h-[min(60vh,32rem)] space-y-3 overflow-y-auto" aria-label={t("title")}>
          {BOARD_WORKFLOW_STATUS_CATEGORIES.map((category) => {
            const grouped = statuses.filter((status) => status.category === category);
            return (
              <section key={category} aria-label={categoryLabel(category)}>
                <h3 className="border-b border-border px-1 py-1.5 text-ui-sm font-medium text-foreground-subtle">
                  {categoryLabel(category)}
                </h3>
                <ol>
                  {grouped.map((status, index) => (
                    <li
                      key={status.id}
                      className="flex min-w-0 items-center gap-2 border-b border-border px-1 py-2 last:border-b-0"
                    >
                      <input
                        aria-label={statusLabel(status)}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input-border bg-input px-2 text-ui-base"
                        maxLength={40}
                        value={statusLabel(status)}
                        onChange={(event) =>
                          setStatuses(
                            statuses.map((entry) =>
                              entry.id === status.id
                                ? { ...entry, label: event.target.value }
                                : entry,
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
                        onClick={() => move(status, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("moveDown")}
                        disabled={index === grouped.length - 1}
                        onClick={() => move(status, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("remove")}
                        disabled={statuses.length === 1 || (status.enabled && enabledCount === 1)}
                        onClick={() =>
                          setStatuses(statuses.filter((entry) => entry.id !== status.id))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
        <form
          className="flex flex-wrap gap-2"
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
          <Select
            value={newCategory}
            onValueChange={(value) => setNewCategory(value as BoardWorkflowStatusCategory)}
          >
            <SelectTrigger aria-label={t("newStatusCategory")} className="min-w-32 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARD_WORKFLOW_STATUS_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {categoryLabel(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
