import { useStore } from "zustand";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Folder, Search, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { agentBoardStore } from "@/store/agentBoardStore.js";
import { useAgentBoardProjects } from "@/hooks/useAgentBoardData.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
export function AgentBoardSidebar({ workspaceTabs }: { workspaceTabs: WorkspaceTabState[] }) {
  const { intl } = useZCodeIntl();
  const preferences = useStore(agentBoardStore);
  const projects = useAgentBoardProjects(workspaceTabs);
  const pinned = (preferences.pinnedProjects ?? projects.slice(0, 4).map((p) => p.key)).filter(
    (key) => projects.some((project) => project.key === key),
  );
  return (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-4"
      aria-label={intl.formatMessage({ id: "agentBoard.projects" })}
    >
      <Button
        variant="ghost"
        className="justify-start gap-2"
        aria-pressed={!projects.some((project) => project.key === preferences.project)}
        onClick={() => preferences.selectProject(null)}
      >
        <LayoutGrid className="size-4" />
        {intl.formatMessage({ id: "agentBoard.allProjects" })}
      </Button>
      <p className="px-3 pt-5 pb-1 text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "agentBoard.pinnedProjects" })}
      </p>
      {projects
        .filter((p) => pinned.includes(p.key))
        .map((project) => (
          <Button
            key={project.key}
            variant="ghost"
            title={`${project.label}\n${project.key}`}
            aria-pressed={preferences.project === project.key}
            className="justify-start gap-2 aria-pressed:bg-selected"
            onClick={() => preferences.selectProject(project.key)}
          >
            <Folder className="size-4 shrink-0" />
            <span className="truncate">{project.label}</span>
          </Button>
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
