import { useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import {
  boardAgentLabel,
  boardStatusIndicator,
  matchesBoardTracking,
  type BoardItem,
  type BoardProject,
  type BoardTracking,
} from "./agentBoardModel.js";

function toggleKey(keys: string[], key: string, checked: boolean) {
  return checked ? [...new Set([...keys, key])] : keys.filter((k) => k !== key);
}

export function AgentBoardTrackingDialog({
  projects,
  items: allItems,
  tracking,
  onSave,
  onClose,
}: {
  projects: BoardProject[];
  items: BoardItem[];
  tracking: BoardTracking;
  onSave(tracking: BoardTracking): void;
  onClose(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const [draft, setDraft] = useState(tracking);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  // 完成待办已由公共看板投影排除；此处仅排除归档候选，搜索和计数共用同一列表。
  const items = allItems.filter((item) => !item.archived);
  const groups = [
    {
      key: "work-tasks",
      label: t("workTasks"),
      standalone: false,
      items: items.filter((item) => item.kind === "work-task"),
      path: "",
    },
    {
      key: "standalone",
      label: t("standalone"),
      standalone: true,
      items: items.filter(
        (item) => item.kind !== "work-task" && item.workspacePurpose === "conversation",
      ),
      path: "",
    },
    ...projects
      .filter((p) => p.tabs[0]?.workspacePurpose !== "conversation")
      .map((p) => ({
        key: p.key,
        label: p.label,
        standalone: false,
        path: p.key,
        items: items.filter(
          (item) =>
            item.kind !== "work-task" &&
            item.workspacePurpose !== "conversation" &&
            item.projectKey === p.key,
        ),
      })),
  ];
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: `${group.label} ${group.path}`.toLocaleLowerCase().includes(query)
        ? group.items
        : group.items.filter((item) =>
            `${item.title} ${boardAgentLabel(item)}`.toLocaleLowerCase().includes(query),
          ),
    }))
    .filter(
      (group) =>
        !query ||
        group.items.length > 0 ||
        `${group.label} ${group.path}`.toLocaleLowerCase().includes(query),
    );
  const setItem = (item: BoardItem, checked: boolean) =>
    setDraft((current) => ({
      ...current,
      includedItems: toggleKey(current.includedItems, item.key, checked),
      excludedItems: toggleKey(current.excludedItems, item.key, !checked),
    }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogTitle>{t("manageTracking")}</DialogTitle>
        <DialogDescription>{t("trackingDescription")}</DialogDescription>
        <div
          role="radiogroup"
          aria-label={t("trackingMode")}
          className="flex flex-wrap gap-4 text-ui-base"
        >
          {(["all", "custom"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                name="board-tracking-mode"
                checked={draft.mode === mode}
                onChange={() => setDraft((current) => ({ ...current, mode }))}
              />
              {t(`trackingMode.${mode}`)}
            </label>
          ))}
        </div>
        <input
          aria-label={t("trackingSearch")}
          placeholder={t("trackingSearch")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 shrink-0 rounded-lg border border-border bg-input px-3 text-mobile-input-safe md:text-ui-base"
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <fieldset
            disabled={draft.mode === "all"}
            className="min-w-0 space-y-3 disabled:opacity-60"
          >
            <legend className="sr-only">{t("trackingMode.custom")}</legend>
            {visibleGroups.map((group) => (
              <details
                key={group.key}
                open={Boolean(query) || group.standalone}
                className="rounded-xl border border-border p-3 text-ui-base"
              >
                <summary className="cursor-pointer font-medium">
                  {group.label}{" "}
                  <span className="text-ui-caption text-foreground-subtle">
                    {group.items.length}
                  </span>
                  {group.path ? (
                    <span
                      className="mt-1 block truncate text-ui-caption text-foreground-subtle"
                      title={group.path}
                    >
                      {group.path}
                    </span>
                  ) : null}
                </summary>
                <label className="mt-3 flex items-center gap-2 border-b border-border pb-3">
                  <Checkbox
                    checked={
                      group.key === "work-tasks"
                        ? draft.workTasks
                        : group.standalone
                          ? draft.standalone
                          : draft.projects.includes(group.key)
                    }
                    onCheckedChange={(checked) =>
                      setDraft((current) =>
                        group.key === "work-tasks"
                          ? { ...current, workTasks: checked === true }
                          : group.standalone
                            ? { ...current, standalone: checked === true }
                            : {
                                ...current,
                                projects: toggleKey(current.projects, group.key, checked === true),
                              },
                      )
                    }
                  />
                  {t(group.key === "work-tasks" ? "trackWholeWorkTasks" : "trackWholeGroup")}
                </label>
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const status = boardStatusIndicator(item);
                    return (
                      <label
                        key={item.key}
                        className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-2 hover:bg-surface-hover"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={matchesBoardTracking(item, { ...draft, mode: "custom" })}
                          onCheckedChange={(checked) => setItem(item, checked === true)}
                        />
                        <span className="min-w-0">
                          <span className="line-clamp-2">{item.title || t("untitled")}</span>
                          <span className="inline-flex flex-wrap items-center gap-1 text-ui-caption text-foreground-subtle">
                            <span>{boardAgentLabel(item)} ·</span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              {/* 候选状态原先只有文字；沿用真实状态，离线或等待不播放运行动画。 */}
                              {status === "completed" ? (
                                <CircleCheck
                                  aria-hidden="true"
                                  className="size-3 shrink-0 text-success"
                                />
                              ) : status === "running" ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  strokeWidth={3}
                                  className={`size-3 shrink-0 text-task-running-indicator ${item.online ? "animate-spin motion-reduce:animate-none" : ""}`}
                                />
                              ) : null}
                              {t(`status.${status}`)}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {group.items.length === 0 ? (
                    <p className="py-2 text-ui-caption text-foreground-subtle">{t("empty")}</p>
                  ) : null}
                </div>
              </details>
            ))}
          </fieldset>
          {visibleGroups.length === 0 ? (
            <p className="p-3 text-foreground-subtle">{t("empty")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <span className="mr-auto text-ui-caption text-foreground-subtle">
            {intl.formatMessage(
              { id: "agentBoard.trackingCount" },
              { count: items.filter((item) => matchesBoardTracking(item, draft)).length },
            )}
          </span>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t("saveTracking")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
