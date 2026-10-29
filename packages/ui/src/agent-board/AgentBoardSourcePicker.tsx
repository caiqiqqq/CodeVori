import { useState } from "react";
import { useStore } from "zustand";
import { MessageSquare, Star } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { BoardProject } from "./agentBoardModel.js";

export function AgentBoardSourcePicker({
  projects,
  creating,
  canCreateSession,
  onCreateSession,
  onClose,
}: {
  projects: BoardProject[];
  creating: boolean;
  canCreateSession(tab: WorkspaceTabState): boolean;
  onCreateSession(tab: WorkspaceTabState): void;
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
  const visibleProjects = (creating ? projects : realProjects).filter((p) =>
    `${p.label} ${p.key} ${p.tabs.map((tab) => tab.workspacePath).join(" ")}`
      .toLocaleLowerCase()
      .includes(projectSearch.toLocaleLowerCase()),
  );
  const pickProject = (p: BoardProject) => {
    if (creating) {
      const tab = p.tabs[0];
      if (tab) onCreateSession(tab);
    } else preferences.selectProject(p.key);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] sm:max-w-xl">
        <DialogTitle>{creating ? t("chooseNewProject") : t("projects")}</DialogTitle>
        <DialogDescription>{t("projectLimit")}</DialogDescription>
        <input
          autoFocus
          aria-label={t("searchProjects")}
          placeholder={t("searchProjects")}
          value={projectSearch}
          onChange={(e) => setProjectSearch(e.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-input px-3 text-mobile-input-safe md:text-ui-base"
        />
        <div className="min-h-0 max-h-[55dvh] overflow-y-auto">
          {!creating ? (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                preferences.selectProject(null);
                onClose();
              }}
            >
              {t("allProjects")}
            </Button>
          ) : null}
          {!creating ? (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                preferences.selectStandalone();
                onClose();
              }}
            >
              <MessageSquare className="size-4" />
              {t("standalone")}
            </Button>
          ) : null}
          {!creating ? (
            <Button
              variant="ghost"
              className="justify-start gap-2"
              aria-pressed={preferences.category === "work-tasks"}
              onClick={() => {
                preferences.selectWorkTasks();
                onClose();
              }}
            >
              <span>{t("workTasks")}</span>
            </Button>
          ) : null}
          {visibleProjects.map((p) => (
            <div key={p.key} className="flex items-center gap-2 border-b border-border/60 py-1">
              <button
                className="min-w-0 flex-1 rounded-lg px-2 py-2 text-start hover:bg-surface-hover disabled:opacity-50"
                disabled={creating && (!p.tabs[0] || !canCreateSession(p.tabs[0]))}
                onClick={() => pickProject(p)}
              >
                <span className="block truncate font-medium">{p.label}</span>
                {p.tabs[0]?.workspacePurpose !== "conversation" ? (
                  <span className="block truncate text-ui-caption text-foreground-subtle">
                    {p.key}
                  </span>
                ) : null}
              </button>
              {!creating ? (
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
              ) : null}
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
