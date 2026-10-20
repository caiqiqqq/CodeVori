import { memo } from "react";
import type { AcpAgent } from "@zcode/shared";
import { AcpAgentIcon } from "@/components/AcpAgentIcon.js";
import { TaskAgentIcon } from "@/components/TaskAgentIcon.js";

export const WorkbenchConversationTabContent = memo(function WorkbenchConversationTabContent({
  title,
  agent,
  model,
  workspacePath,
  workspaceIdentity,
}: {
  title: string;
  agent?: AcpAgent;
  model?: string;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  return (
    <span
      data-workbench-tab-title={title}
      title={title}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {agent ? (
        <AcpAgentIcon agent={agent} />
      ) : (
        <TaskAgentIcon task={{ model, workspacePath, workspaceIdentity }} />
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </span>
  );
});
