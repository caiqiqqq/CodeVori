import { useStore } from "zustand";
import { useMemo } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Folder, Search, LayoutGrid, MessageSquare, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useAgentBoardData } from "@/hooks/useAgentBoardData.js";
import { AgentBoardSidebarRow } from "./AgentBoardSidebarRow.js";
import { countBoardSidebarItems } from "./agentBoardSidebarCounts.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
export function AgentBoardSidebar({ workspaceTabs }: { workspaceTabs: WorkspaceTabState[] }) {
  const { intl } = useZCodeIntl();
  const preferences = useStore(agentBoardStore);
  const data = useAgentBoardData(workspaceTabs);
  const counts = useMemo(
    () => countBoardSidebarItems(data.items, preferences.tracking, preferences.stagedItems),
    [data.items, preferences.tracking, preferences.stagedItems],
  );
  const projects = data.projects.filter((p) => p.tabs[0]?.workspacePurpose !== "conversation");
  const pinned = (preferences.pinnedProjects ?? projects.slice(0, 4).map((p) => p.key)).filter(
    (key) => projects.some((project) => project.key === key),
  );
  return (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-4"
      aria-label={intl.formatMessage({ id: "agentBoard.projects" })}
    >
      <AgentBoardSidebarRow
        icon={LayoutGrid}
        label={intl.formatMessage({ id: "agentBoard.allProjects" })}
        counts={counts.all}
        aria-pressed={
          preferences.category === "all" &&
          !projects.some((project) => project.key === preferences.project)
        }
        onClick={() => preferences.selectProject(null)}
      />
      <AgentBoardSidebarRow
        icon={MessageSquare}
        label={intl.formatMessage({ id: "agentBoard.standalone" })}
        counts={counts.standalone}
        aria-pressed={preferences.category === "standalone"}
        onClick={preferences.selectStandalone}
      />
      <AgentBoardSidebarRow
        icon={ListTodo}
        label={intl.formatMessage({ id: "agentBoard.workTasks" })}
        counts={counts.workTasks}
        aria-pressed={preferences.category === "work-tasks"}
        onClick={() => {
          preferences.selectWorkTasks();
        }}
      />
      <p className="px-3 pt-5 pb-1 text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "agentBoard.pinnedProjects" })}
      </p>
      {projects
        .filter((p) => pinned.includes(p.key))
        .map((project) => (
          <AgentBoardSidebarRow
            key={project.key}
            icon={Folder}
            label={project.label}
            counts={counts.projects.get(project.key)}
            title={
              project.tabs[0]?.workspacePurpose === "conversation"
                ? project.label
                : `${project.label}\n${project.key}`
            }
            aria-pressed={preferences.project === project.key}
            onClick={() => preferences.selectProject(project.key)}
          />
        ))}
      <Button
        variant="ghost"
        className="justify-start gap-2 text-foreground-subtle"
        onClick={() => preferences.setPickerOpen(true)}
      >
        <Search className="size-4" />
        {intl.formatMessage({ id: "agentBoard.browseProjects" })}
      </Button>
    </nav>
  );
}
