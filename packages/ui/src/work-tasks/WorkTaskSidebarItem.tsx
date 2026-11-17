import type { WorkTask } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { requestWorkTaskConversation } from "@/lib/worktreeSettingsNavigation.js";
import { workTaskSelectionKey } from "@/store/workTaskNavigationStore.js";
import { useWorkTaskSidebar } from "./WorkTaskSidebarContext.js";
import { WorkTaskAgent, WorkTaskStatus } from "./WorkTaskParts.js";

export function WorkTaskSidebarItem({ task }: { task: WorkTask }) {
  const { selectedKey } = useWorkTaskSidebar();
  const selected = selectedKey === workTaskSelectionKey(task);
  return (
    <li data-work-task-id={task.id} data-workspace-path={task.workspacePath}>
      <Button
        variant="ghost"
        title={task.title}
        aria-pressed={selected}
        onClick={() => requestWorkTaskConversation(task)}
        data-selected={selected}
        data-testid="work-task-sidebar-row"
        className={cn(
          "sidebar-conversation-row flex h-9 w-full min-w-0 justify-start gap-2 rounded-lg px-3 text-ui-base font-normal",
          selected && "bg-selected",
        )}
      >
        <WorkTaskAgent task={task} iconOnly />
        <span className="min-w-0 flex-1 truncate text-left">{task.title}</span>
        <WorkTaskStatus task={task} />
      </Button>
    </li>
  );
}
