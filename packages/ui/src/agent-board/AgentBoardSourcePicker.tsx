import { useState } from "react";
import { useStore } from "zustand";
import { Check, LayoutGrid, MessageSquare, Star, ListTodo } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import type { BoardProject } from "./agentBoardModel.js";

export function AgentBoardSourcePicker({
  projects,
  onClose,
}: {
  projects: BoardProject[];
  onClose(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id: `agentBoard.${id}` });
  const preferences = useStore(agentBoardStore);
  const [projectSearch, setProjectSearch] = useState("");
  const realProjects = projects.filter((p) => p.tabs[0]?.workspacePurpose !== "conversation");
  const pinned = (preferences.pinnedProjects ?? realProjects.slice(0, 4).map((p) => p.key)).filter(
    (key) => realProjects.some((project) => project.key === key),
  );
  // 快捷入口与侧栏从同一偏好派生选中态，失效项目也按现有规则回到“所有项目”。
  const shortcuts = [
    {
      id: "allProjects",
      icon: LayoutGrid,
      selected:
        preferences.category === "all" &&
        !realProjects.some((project) => project.key === preferences.project),
      select: () => preferences.selectProject(null),
    },
    {
      id: "standalone",
      icon: MessageSquare,
      selected: preferences.category === "standalone",
      select: preferences.selectStandalone,
    },
    {
      id: "workTasks",
      icon: ListTodo,
      selected: preferences.category === "work-tasks",
      select: preferences.selectWorkTasks,
    },
  ];
  const visibleProjects = realProjects.filter((p) =>
    `${p.label} ${p.key} ${p.tabs.map((tab) => tab.workspacePath).join(" ")}`
      .toLocaleLowerCase()
      .includes(projectSearch.toLocaleLowerCase()),
  );
  const pickProject = (p: BoardProject) => {
    preferences.selectProject(p.key);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogTitle>{t("projects")}</DialogTitle>
        <DialogDescription>{t("projectLimit")}</DialogDescription>
        <input
          autoFocus
          aria-label={t("searchProjects")}
          placeholder={t("searchProjects")}
          value={projectSearch}
          onChange={(e) => setProjectSearch(e.target.value)}
          className="h-10 w-full shrink-0 rounded-lg border border-border bg-input px-3 text-mobile-input-safe md:text-ui-base"
        />
        <div
          role="group"
          aria-label={t("projects")}
          className="grid shrink-0 grid-cols-1 gap-2 border-b border-border/60 pb-4 sm:grid-cols-3"
        >
          {shortcuts.map(({ id, icon: Icon, selected, select }) => (
            <Button
              key={id}
              variant="ghost"
              aria-pressed={selected}
              className="relative h-auto min-h-11 min-w-0 justify-start gap-3 rounded-lg border-border/60 bg-surface py-2.5 ps-3 pe-8 text-start text-ui-caption font-medium whitespace-normal text-foreground-subtle hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand aria-pressed:border-border-hover aria-pressed:bg-selected aria-pressed:text-foreground sm:min-h-18 sm:flex-col sm:justify-center sm:gap-2 sm:px-2 sm:py-3 sm:text-center"
              onClick={() => {
                select();
                onClose();
              }}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span className="min-w-0 max-w-full">{t(id)}</span>
              {selected ? (
                <Check
                  aria-hidden="true"
                  className="absolute end-3 top-1/2 size-3 -translate-y-1/2 text-brand sm:end-2 sm:top-2 sm:translate-y-0"
                />
              ) : null}
            </Button>
          ))}
        </div>
        <div className="min-h-0 max-h-[55dvh] overflow-y-auto">
          {visibleProjects.map((p) => (
            <div key={p.key} className="flex items-center gap-2 border-b border-border/60 py-1">
              <button
                className="min-w-0 flex-1 rounded-lg px-2 py-2 text-start hover:bg-surface-hover disabled:opacity-50"
                onClick={() => pickProject(p)}
              >
                <span className="block truncate font-medium">{p.label}</span>
                {p.tabs[0]?.workspacePurpose !== "conversation" ? (
                  <span className="block truncate text-ui-caption text-foreground-subtle">
                    {p.key}
                  </span>
                ) : null}
              </button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!pinned.includes(p.key) && pinned.length >= 6}
                aria-label={`${pinned.includes(p.key) ? t("unpinProject") : t("pinProject")} ${p.label}`}
                aria-pressed={pinned.includes(p.key)}
                onClick={() =>
                  preferences.toggleProject(
                    p.key,
                    realProjects.slice(0, 4).map((p) => p.key),
                    realProjects.map((p) => p.key),
                  )
                }
              >
                <Star
                  className={`size-4 ${pinned.includes(p.key) ? "fill-current text-warning" : ""}`}
                />
              </Button>
            </div>
          ))}
          {visibleProjects.length === 0 ? (
            <p className="p-4 text-foreground-subtle">{t("empty")}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
